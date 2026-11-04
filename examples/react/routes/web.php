<?php

declare(strict_types=1);

use Example\Http\Controllers\ProfileController;
use Illuminate\Support\Facades\Route;

Route::get('/csrf-cookie', static fn () => response()->noContent());
Route::patch('/users/{user}', [ProfileController::class, 'update'])->name('profile.update');
