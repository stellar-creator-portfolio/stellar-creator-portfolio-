import { Platform } from "react-native";

const AUTH_MODULE = "expo-local-authentication";

export interface BiometricSupportInfo {
  supported: boolean;
  methods: string[];
  reason?: string;
}

export interface BiometricAuthResult {
  success: boolean;
  error?: string;
}

async function loadAuthenticationModule() {
  try {
    const moduleName = AUTH_MODULE;
    return await import(moduleName);
  } catch {
    return null;
  }
}

export async function getBiometricSupport(): Promise<BiometricSupportInfo> {
  const LocalAuthentication = await loadAuthenticationModule();
  if (!LocalAuthentication) {
    return {
      supported: false,
      methods: [],
      reason:
        "Biometric authentication support is unavailable. Install expo-local-authentication to enable native Face ID / Touch ID on supported devices.",
    };
  }

  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    const supportedTypes =
      await LocalAuthentication.supportedAuthenticationTypesAsync();

    if (!hasHardware || !isEnrolled) {
      return {
        supported: false,
        methods: [],
        reason:
          "Your device does not support Face ID or Touch ID, or no biometric credential is enrolled.",
      };
    }

    const methods = supportedTypes.map((type: number) => {
      if (type === LocalAuthentication.AuthenticationType.FACE_ID)
        return "Face ID";
      if (type === LocalAuthentication.AuthenticationType.FINGERPRINT)
        return "Touch ID";
      if (type === LocalAuthentication.AuthenticationType.IRIS) return "Iris";
      return "Biometric";
    });

    return { supported: true, methods };
  } catch (error) {
    return {
      supported: false,
      methods: [],
      reason:
        error instanceof Error
          ? error.message
          : "Failed to detect biometric capabilities.",
    };
  }
}

export async function authenticateBiometric(): Promise<BiometricAuthResult> {
  const LocalAuthentication = await loadAuthenticationModule();
  if (!LocalAuthentication) {
    return {
      success: false,
      error:
        "Missing biometric support library. Please install expo-local-authentication.",
    };
  }

  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Authenticate to access Stellar",
      cancelLabel: "Cancel",
      fallbackLabel: "Use passcode",
      disableDeviceFallback: false,
    });

    return {
      success: result.success,
      error: result.success
        ? undefined
        : (result.error ?? "Authentication failed"),
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Authentication failed unexpectedly.",
    };
  }
}
