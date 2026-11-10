import { Controller, type Control, type FieldValues, type Path } from 'react-hook-form';
import { Field, PasswordField, type FieldProps } from './ui';

/** react-hook-form binding for the text fields. */
export function FormField<T extends FieldValues>({
  control,
  name,
  password,
  ...props
}: Omit<FieldProps, 'value' | 'onChangeText' | 'error'> & { control: Control<T>; name: Path<T>; password?: boolean }) {
  const Component = password ? PasswordField : Field;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Component
          {...props}
          ref={field.ref}
          value={(field.value as string | undefined) ?? ''}
          onChangeText={field.onChange}
          onBlur={field.onBlur}
          error={fieldState.error?.message}
        />
      )}
    />
  );
}
