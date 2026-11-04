<?php

declare(strict_types=1);

namespace Example;

use Example\Enums\FormField;
use Formbraid\Laravel\Field;
use Formbraid\Laravel\FieldGroup;
use Illuminate\Foundation\Http\FormRequest;

final class UpdateProfileRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'email' => 'required|email',
            'newsletter' => ['required', 'boolean'],
            'company' => ['nullable', 'string', 'required_if:newsletter,true'],
            'address_line_1' => ['required', 'string'],
            'address_line_2' => ['nullable', 'string'],
            'city' => ['required', 'string'],
            'state' => ['required', 'string', 'max:2'],
            'zip' => ['required', 'string', 'min:5', 'max:10'],
        ];
    }

    public function fields(): array
    {
        return ['email' => Field::make()->helpText('We use this to send profile updates.')];
    }

    public function groups(): array
    {
        return ['address' => FieldGroup::make(FormField::AddressAutocomplete)->label('Delivery Address')->fields([
            'line1' => 'address_line_1', 'line2' => 'address_line_2', 'city' => 'city', 'state' => 'state', 'postalCode' => 'zip',
        ])];
    }
}
