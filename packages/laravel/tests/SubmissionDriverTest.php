<?php

declare(strict_types=1);

namespace Formbraid\Laravel\Tests;

use Formbraid\Laravel\Contracts\SubmissionDriver;
use Formbraid\Laravel\Drivers\Fetch;
use Formbraid\Laravel\Drivers\Inertia;
use Formbraid\Laravel\FormbraidServiceProvider;
use InvalidArgumentException;
use Orchestra\Testbench\TestCase;
use PHPUnit\Framework\Attributes\DataProvider;

final class SubmissionDriverTest extends TestCase
{
    protected function getPackageProviders($app): array
    {
        return [FormbraidServiceProvider::class];
    }

    public function test_fetch_is_the_container_resolved_default_and_inertia_can_be_selected(): void
    {
        self::assertSame(Fetch::class, config('formbraid.submission_driver'));
        self::assertInstanceOf(SubmissionDriver::class, app()->make(config('formbraid.submission_driver')));
        config(['formbraid.submission_driver' => Inertia::class]);
        self::assertInstanceOf(Inertia::class, app()->make(config('formbraid.submission_driver')));
    }

    #[DataProvider('drivers')]
    public function test_generates_a_standalone_callback_and_preserves_the_endpoint_expression(string $class): void
    {
        $expression = 'routeUrl("users/{user}", parameters)';
        $callback = app()->make($class)->generate($expression, 'PATCH');
        self::assertStringContainsString($expression, $callback);
        self::assertStringContainsString('"patch"', $callback);
        self::assertStringNotContainsString('__FORMBRAID_', $callback);
        self::assertStringNotContainsString('@formbraid/laravel', $callback);
        if ($class === Inertia::class) {
            self::assertStringContainsString("import('@inertiajs/react')", $callback);
            self::assertStringNotContainsString('XSRF', $callback);
            self::assertStringNotContainsString('document.cookie', $callback);
        } else {
            self::assertStringContainsString("import('effect/http')", $callback);
        }
        self::assertStringContainsString("import('effect')", $callback);
    }

    #[DataProvider('drivers')]
    public function test_template_markers_inside_the_endpoint_are_not_replaced_recursively(string $class): void
    {
        $expression = '"/submit/__FORMBRAID_METHOD__/__FORMBRAID_ENDPOINT__"';
        $callback = app()->make($class)->generate($expression, 'POST');
        self::assertStringContainsString($expression, $callback);
    }

    #[DataProvider('drivers')]
    public function test_rejects_unsupported_methods_instead_of_injecting_source(string $class): void
    {
        $this->expectException(InvalidArgumentException::class);
        app()->make($class)->generate('"/users"', 'POST"; throw new Error()');
    }

    public static function drivers(): array
    {
        return [[Fetch::class], [Inertia::class]];
    }
}
