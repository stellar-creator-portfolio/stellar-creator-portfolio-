/**
 * ValidatedInput — Issue #562 demonstration
 * "Leverage specific generalized standard localized Mobile form validations identically securely"
 *
 * Features:
 *  - Real-time validation with debouncing
 *  - Error message display
 *  - Secure input sanitization
 *  - Accessibility support
 *  - Dark mode support
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { FontSize, FontWeight, Radius, Spacing } from '../../theme/tokens';
import { ValidatorFn, ValidationResult } from '../../utils/formValidation';

interface ValidatedInputProps extends Omit<TextInputProps, 'onChangeText'> {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  validator?: ValidatorFn;
  sanitizer?: (value: string) => string;
  validateOnBlur?: boolean;
  validateOnChange?: boolean;
  debounceMs?: number;
  errorMessage?: string;
  required?: boolean;
}

export function ValidatedInput({
  label,
  value,
  onChangeText,
  validator,
  sanitizer,
  validateOnBlur = true,
  validateOnChange = false,
  debounceMs = 300,
  errorMessage: externalError,
  required = false,
  ...textInputProps
}: ValidatedInputProps) {
  const { colors } = useTheme();
  const [touched, setTouched] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult>({ isValid: true });
  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(null);

  // Validate input
  const validate = useCallback(
    (text: string) => {
      if (!validator) {
        setValidationResult({ isValid: true });
        return;
      }

      const result = validator(text);
      setValidationResult(result);
    },
    [validator]
  );

  // Handle text change
  const handleChangeText = useCallback(
    (text: string) => {
      // Apply sanitizer if provided
      const sanitizedText = sanitizer ? sanitizer(text) : text;
      onChangeText(sanitizedText);

      // Validate on change if enabled
      if (validateOnChange) {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }

        const timer = setTimeout(() => {
          validate(sanitizedText);
        }, debounceMs);

        setDebounceTimer(timer);
      }
    },
    [onChangeText, sanitizer, validateOnChange, validate, debounceMs, debounceTimer]
  );

  // Handle blur
  const handleBlur = useCallback(() => {
    setTouched(true);
    if (validateOnBlur) {
      validate(value);
    }
  }, [validateOnBlur, validate, value]);

  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    };
  }, [debounceTimer]);

  // Determine if error should be shown
  const showError = touched && !validationResult.isValid;
  const errorText = externalError || validationResult.error;

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: colors.text }]}>
        {label}
        {required && <Text style={[styles.required, { color: colors.error }]}> *</Text>}
      </Text>
      <TextInput
        {...textInputProps}
        value={value}
        onChangeText={handleChangeText}
        onBlur={handleBlur}
        style={[
          styles.input,
          {
            backgroundColor: colors.surface,
            borderColor: showError ? colors.error : colors.border,
            color: colors.text,
          },
          textInputProps.style,
        ]}
        placeholderTextColor={colors.textTertiary}
        accessibilityLabel={label}
        accessibilityRequired={required}
        accessibilityInvalid={showError}
      />
      {showError && errorText && (
        <Text style={[styles.error, { color: colors.error }]} accessibilityLiveRegion="polite">
          {errorText}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.base,
  },
  label: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    marginBottom: Spacing.xs,
  },
  required: {
    fontSize: FontSize.sm,
  },
  input: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.base,
  },
  error: {
    fontSize: FontSize.xs,
    marginTop: Spacing.xs,
  },
});
