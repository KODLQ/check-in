import { displayNameSchema, fieldErrors } from '@check-in/shared';

/** i18n key of the problem with a display name (onboarding and settings), or null when it is valid. */
export function displayNameErrorKey(name: string): string | null {
  const errs = fieldErrors(displayNameSchema.safeParse(name));
  return errs ? `errors.${errs._}` : null;
}
