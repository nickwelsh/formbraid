<?php

declare(strict_types=1);

namespace Example\Http\Controllers;

use Example\UpdateProfileRequest;
use Symfony\Component\HttpFoundation\Response;

final class ProfileController
{
    public function update(UpdateProfileRequest $request, string $user): Response
    {
        // A server-only rule exercises the generated handler's 422 error mapping.
        $request->validate(['email' => 'not_in:blocked@example.com']);

        return response()->json(['user' => $user, 'saved' => $request->validated()]);
    }
}
