/**
 * OnboardingScreen — Wrapper for OnboardingWalkthrough
 * Demonstrates Issue #563 implementation
 */

import React from 'react';
import { OnboardingWalkthrough } from '../components/onboarding/OnboardingWalkthrough';

interface OnboardingScreenProps {
  onComplete: () => void;
}

export function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  return <OnboardingWalkthrough onComplete={onComplete} />;
}
