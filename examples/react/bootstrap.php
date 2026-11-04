<?php

declare(strict_types=1);

use Formbraid\Laravel\FormbraidServiceProvider;
use Illuminate\Foundation\Application;

// Use the application's Composer install, or the workspace package's dev dependencies.
$loader = require is_file(__DIR__.'/vendor/autoload.php') ? __DIR__.'/vendor/autoload.php' : __DIR__.'/../../packages/laravel/vendor/autoload.php';
$loader->addPsr4('Example\\', __DIR__.'/php');
foreach (['bootstrap/cache', 'storage/framework/sessions', 'storage/framework/views', 'storage/logs'] as $directory) {
    if (! is_dir(__DIR__.'/'.$directory)) {
        mkdir(__DIR__.'/'.$directory, 0755, true);
    }
}
// Disposable example-only key, persisted locally so the HTTP and Artisan processes agree.
$key = __DIR__.'/storage/app.key';
if (! is_file($key)) {
    file_put_contents($key, 'base64:'.base64_encode(random_bytes(32)));
    chmod($key, 0600);
}
putenv('APP_KEY='.file_get_contents($key));
putenv('APP_ENV=local');
putenv('APP_DEBUG=true');
putenv('SESSION_DRIVER=file');
putenv('SESSION_SECURE_COOKIE=false');

return Application::configure(basePath: __DIR__)
    ->withRouting(web: __DIR__.'/routes/web.php')
    ->withProviders([FormbraidServiceProvider::class])
    ->withMiddleware()
    ->withExceptions()
    ->create();
