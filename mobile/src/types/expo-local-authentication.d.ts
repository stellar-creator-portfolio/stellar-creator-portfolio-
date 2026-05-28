declare module "expo-local-authentication" {
  export interface BiometricAuthenticationResult {
    success: boolean;
    error?: string;
    warning?: string;
  }

  export interface AuthenticationType {
    FACE_ID: number;
    FINGERPRINT: number;
    IRIS: number;
  }

  export const AuthenticationType: AuthenticationType;

  export function hasHardwareAsync(): Promise<boolean>;
  export function isEnrolledAsync(): Promise<boolean>;
  export function supportedAuthenticationTypesAsync(): Promise<number[]>;
  export function authenticateAsync(options: {
    promptMessage?: string;
    fallbackLabel?: string;
    cancelLabel?: string;
    disableDeviceFallback?: boolean;
  }): Promise<BiometricAuthenticationResult>;
}
