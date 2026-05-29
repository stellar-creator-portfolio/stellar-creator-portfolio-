/**
 * useProposalForm — Secure form state for bounty proposals/applications
 *
 * - Field-level validation with sanitization (strips HTML/scripts)
 * - Tracks dirty/touched per field to avoid premature errors
 * - Returns a stable submit handler that rejects invalid state
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
  composeValidators,
  Sanitizers,
  Validators,
  ValidationResult,
} from "../utils/formValidation";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProposalFields {
  coverLetter: string;
  proposedRate: string;
  estimatedDays: string;
  portfolioUrl: string;
}

type FieldName = keyof ProposalFields;

interface FieldMeta {
  error: string | undefined;
  touched: boolean;
}

export interface ProposalFormState {
  fields: ProposalFields;
  meta: Record<FieldName, FieldMeta>;
  isValid: boolean;
  isSubmitting: boolean;
}

// ─── Validators ───────────────────────────────────────────────────────────────

const FIELD_VALIDATORS: Record<FieldName, (v: string) => ValidationResult> = {
  coverLetter: composeValidators(
    Validators.required("Cover letter is required"),
    Validators.minLength(50, "Please write at least 50 characters"),
    Validators.maxLength(2000, "Maximum 2000 characters")
  ),
  proposedRate: composeValidators(
    Validators.required("Rate is required"),
    Validators.numeric("Must be a number"),
    Validators.range(1, 999999, "Rate must be between 1 and 999,999")
  ),
  estimatedDays: composeValidators(
    Validators.required("Estimated days is required"),
    Validators.numeric("Must be a number"),
    Validators.range(1, 365, "Must be between 1 and 365 days")
  ),
  portfolioUrl: (v) => {
    if (!v.trim()) return { isValid: true }; // optional
    return Validators.url("Enter a valid URL (https://…)")(v);
  },
};

const INITIAL_FIELDS: ProposalFields = {
  coverLetter: "",
  proposedRate: "",
  estimatedDays: "",
  portfolioUrl: "",
};

const INITIAL_META: Record<FieldName, FieldMeta> = {
  coverLetter: { error: undefined, touched: false },
  proposedRate: { error: undefined, touched: false },
  estimatedDays: { error: undefined, touched: false },
  portfolioUrl: { error: undefined, touched: false },
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useProposalForm(onSubmit: (fields: ProposalFields) => Promise<void>) {
  const [fields, setFields] = useState<ProposalFields>(INITIAL_FIELDS);
  const [meta, setMeta] = useState<Record<FieldName, FieldMeta>>(INITIAL_META);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isMountedRef = useRef(true);

  const validateField = useCallback(
    (name: FieldName, value: string): string | undefined => {
      const result = FIELD_VALIDATORS[name](value);
      return result.isValid ? undefined : result.error;
    },
    []
  );

  const handleChange = useCallback(
    (name: FieldName, raw: string) => {
      // Sanitize: strip HTML tags and trim
      const value = Sanitizers.stripHtml(raw);
      setFields((prev) => ({ ...prev, [name]: value }));
      setMeta((prev) => ({
        ...prev,
        [name]: {
          touched: prev[name].touched,
          error: prev[name].touched ? validateField(name, value) : undefined,
        },
      }));
    },
    [validateField]
  );

  const handleBlur = useCallback(
    (name: FieldName) => {
      setMeta((prev) => ({
        ...prev,
        [name]: {
          touched: true,
          error: validateField(name, fields[name]),
        },
      }));
    },
    [fields, validateField]
  );

  const isValid = useMemo(() => {
    return (Object.keys(FIELD_VALIDATORS) as FieldName[]).every(
      (name) => !validateField(name, fields[name])
    );
  }, [fields, validateField]);

  const submit = useCallback(async () => {
    // Touch all fields to surface errors
    const newMeta = { ...meta };
    (Object.keys(FIELD_VALIDATORS) as FieldName[]).forEach((name) => {
      newMeta[name] = { touched: true, error: validateField(name, fields[name]) };
    });
    setMeta(newMeta);

    if (!isValid) return;

    setIsSubmitting(true);
    try {
      await onSubmit(fields);
    } finally {
      if (isMountedRef.current) setIsSubmitting(false);
    }
  }, [fields, meta, isValid, onSubmit, validateField]);

  const reset = useCallback(() => {
    setFields(INITIAL_FIELDS);
    setMeta(INITIAL_META);
    setIsSubmitting(false);
  }, []);

  return { fields, meta, isValid, isSubmitting, handleChange, handleBlur, submit, reset };
}
