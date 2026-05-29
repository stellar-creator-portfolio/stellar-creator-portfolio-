/**
 * useRegisterForm — Multi-step registration form state
 *
 * Step 1: Profile  (name, username, email)
 * Step 2: Discipline + skills selection
 * Step 3: Wallet connect (delegated to useWalletAuth)
 *
 * Security: all text fields sanitized (HTML stripped) on change.
 * Validation runs on blur; submit touches all fields first.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
  composeValidators,
  Sanitizers,
  Validators,
  ValidationResult,
} from "../utils/formValidation";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProfileFields {
  name: string;
  username: string;
  email: string;
}

export interface DisciplineFields {
  discipline: string;
  skills: string[]; // selected skill tags
}

type ProfileKey = keyof ProfileFields;

interface FieldMeta {
  error: string | undefined;
  touched: boolean;
}

export interface RegisterFormState {
  step: 1 | 2 | 3;
  profile: ProfileFields;
  discipline: DisciplineFields;
  profileMeta: Record<ProfileKey, FieldMeta>;
  isSubmitting: boolean;
}

// ─── Validators ───────────────────────────────────────────────────────────────

const PROFILE_VALIDATORS: Record<ProfileKey, (v: string) => ValidationResult> = {
  name: composeValidators(
    Validators.required("Full name is required"),
    Validators.minLength(2, "At least 2 characters"),
    Validators.maxLength(60, "Maximum 60 characters")
  ),
  username: composeValidators(
    Validators.required("Username is required"),
    Validators.minLength(3, "At least 3 characters"),
    Validators.maxLength(30, "Maximum 30 characters"),
    Validators.username()
  ),
  email: composeValidators(
    Validators.required("Email is required"),
    Validators.email()
  ),
};

const INITIAL_PROFILE: ProfileFields = { name: "", username: "", email: "" };
const INITIAL_META: Record<ProfileKey, FieldMeta> = {
  name:     { error: undefined, touched: false },
  username: { error: undefined, touched: false },
  email:    { error: undefined, touched: false },
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useRegisterForm(
  onComplete: (profile: ProfileFields, discipline: DisciplineFields) => Promise<void>
) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [profile, setProfile] = useState<ProfileFields>(INITIAL_PROFILE);
  const [profileMeta, setProfileMeta] = useState<Record<ProfileKey, FieldMeta>>(INITIAL_META);
  const [discipline, setDiscipline] = useState<DisciplineFields>({ discipline: "", skills: [] });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isMountedRef = useRef(true);

  const validateProfileField = useCallback(
    (key: ProfileKey, value: string): string | undefined => {
      const r = PROFILE_VALIDATORS[key](value);
      return r.isValid ? undefined : r.error;
    },
    []
  );

  // ── Step 1 handlers ──────────────────────────────────────────────────────

  const handleProfileChange = useCallback(
    (key: ProfileKey, raw: string) => {
      const value = Sanitizers.stripHtml(Sanitizers.trim(raw));
      setProfile((p) => ({ ...p, [key]: value }));
      setProfileMeta((m) => ({
        ...m,
        [key]: {
          touched: m[key].touched,
          error: m[key].touched ? validateProfileField(key, value) : undefined,
        },
      }));
    },
    [validateProfileField]
  );

  const handleProfileBlur = useCallback(
    (key: ProfileKey) => {
      setProfileMeta((m) => ({
        ...m,
        [key]: { touched: true, error: validateProfileField(key, profile[key]) },
      }));
    },
    [profile, validateProfileField]
  );

  const isProfileValid = useMemo(
    () => (Object.keys(PROFILE_VALIDATORS) as ProfileKey[]).every(
      (k) => !validateProfileField(k, profile[k])
    ),
    [profile, validateProfileField]
  );

  const submitStep1 = useCallback(() => {
    // Touch all fields
    const newMeta = { ...profileMeta };
    (Object.keys(PROFILE_VALIDATORS) as ProfileKey[]).forEach((k) => {
      newMeta[k] = { touched: true, error: validateProfileField(k, profile[k]) };
    });
    setProfileMeta(newMeta);
    if (!isProfileValid) return;
    setStep(2);
  }, [profile, profileMeta, isProfileValid, validateProfileField]);

  // ── Step 2 handlers ──────────────────────────────────────────────────────

  const setDisciplineValue = useCallback((d: string) => {
    setDiscipline((prev) => ({ ...prev, discipline: d }));
  }, []);

  const toggleSkill = useCallback((skill: string) => {
    setDiscipline((prev) => ({
      ...prev,
      skills: prev.skills.includes(skill)
        ? prev.skills.filter((s) => s !== skill)
        : prev.skills.length < 8
          ? [...prev.skills, skill]
          : prev.skills,
    }));
  }, []);

  const isDisciplineValid = discipline.discipline.length > 0;

  const submitStep2 = useCallback(() => {
    if (!isDisciplineValid) return;
    setStep(3);
  }, [isDisciplineValid]);

  // ── Final submit (called after wallet connect) ───────────────────────────

  const submitFinal = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await onComplete(profile, discipline);
    } finally {
      if (isMountedRef.current) setIsSubmitting(false);
    }
  }, [profile, discipline, onComplete]);

  const goBack = useCallback(() => {
    setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s));
  }, []);

  return {
    step,
    profile,
    profileMeta,
    discipline,
    isProfileValid,
    isDisciplineValid,
    isSubmitting,
    handleProfileChange,
    handleProfileBlur,
    setDisciplineValue,
    toggleSkill,
    submitStep1,
    submitStep2,
    submitFinal,
    goBack,
  };
}
