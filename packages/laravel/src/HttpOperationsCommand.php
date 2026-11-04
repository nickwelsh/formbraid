<?php

declare(strict_types=1);

namespace Formbraid\Laravel;

use Illuminate\Console\Command;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Routing\Router;
use ReflectionFunction;
use ReflectionMethod;
use ReflectionNamedType;

final class HttpOperationsCommand extends Command
{
    protected $signature = 'formbraid:http';

    protected $description = 'Export HTTP operations associated with Laravel FormRequests';

    public function handle(Router $router): int
    {
        $this->line(json_encode(['version' => 1, 'operations' => self::operations($router)], JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

        return self::SUCCESS;
    }

    /** @return list<array{name: string, schema: class-string, parameters: list<array{name: string, optional: bool}>, binding: array{uri: string, method: string}, controller?: string, action?: string}> */
    public static function operations(Router $router, bool $includeActions = false): array
    {
        $operations = [];
        foreach ($router->getRoutes()->getRoutes() as $route) {
            $action = $route->getAction('uses');
            $controller = null;
            $handler = null;
            if ($action instanceof \Closure) {
                $reflection = new ReflectionFunction($action);
            } elseif (is_string($action) && str_contains($action, '@')) {
                [$controller, $method] = explode('@', $action, 2);
                $handler = $method;
                $reflection = new ReflectionMethod($controller, $method);
            } else {
                continue;
            }
            $requests = [];
            foreach ($reflection->getParameters() as $parameter) {
                $type = $parameter->getType();
                if ($type instanceof ReflectionNamedType && is_subclass_of($type->getName(), FormRequest::class)) {
                    $requests[] = $type->getName();
                }
            }
            if (count($requests) > 1) {
                throw new \RuntimeException('A route operation must reference exactly one FormRequest.');
            }
            if ($requests === []) {
                continue;
            }
            $methods = [];
            foreach ($route->methods() as $method) {
                if (! is_string($method)) {
                    throw new \RuntimeException('Invalid Laravel route method.');
                }
                if (in_array(strtolower($method), ['get', 'post', 'put', 'patch', 'delete'], true)) {
                    $methods[] = $method;
                }
            }
            $parameters = [];
            foreach ($route->parameterNames() as $name) {
                if (! is_string($name)) {
                    throw new \RuntimeException('Invalid Laravel route parameter.');
                }
                $parameters[] = ['name' => $name, 'optional' => str_contains($route->uri(), '{'.$name.'?}')];
            }
            foreach ($methods as $method) {
                $name = $route->getName();
                if (! is_string($name)) {
                    $name = str_replace(['\\', '@'], '.', is_string($action) ? $action : $requests[0].'.'.$method);
                }
                if (count($methods) > 1) {
                    $name .= '.'.strtolower($method);
                }
                $operation = [
                    'name' => $name,
                    'schema' => $requests[0],
                    'parameters' => $parameters,
                    'binding' => ['uri' => $route->uri(), 'method' => strtolower($method)],
                ];
                if ($includeActions && $controller !== null) {
                    $operation['controller'] = $controller;
                    $operation['action'] = $handler;
                }
                $operations[] = $operation;
            }
        }
        usort($operations, static fn (array $left, array $right): int => strcmp($left['name'], $right['name']));

        return $operations;
    }
}
