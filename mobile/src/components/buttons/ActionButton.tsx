import React from "react";
import { Pressable, StyleSheet, Text, ViewStyle } from "react-native";
import { useTheme } from "../../theme/ThemeProvider";
import { FontSize, FontWeight, Radius, Spacing } from "../../theme/tokens";

export type ActionButtonVariant = "primary" | "secondary";

interface ActionButtonProps {
  title: string;
  variant?: ActionButtonVariant;
  onPress: () => void;
  disabled?: boolean;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

export function ActionButton({
  title,
  variant = "primary",
  onPress,
  disabled = false,
  style,
  accessibilityLabel,
}: ActionButtonProps) {
  const { colors } = useTheme();
  const isPrimary = variant === "primary";

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        style,
        {
          backgroundColor: isPrimary ? colors.primary : "transparent",
          borderColor: isPrimary ? colors.primary : colors.border,
          borderWidth: isPrimary ? 0 : 1,
          opacity: disabled ? 0.55 : pressed ? 0.8 : 1,
        },
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={accessibilityLabel ?? title}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Text
        style={[
          styles.text,
          {
            color: isPrimary ? colors.textInverse : colors.text,
          },
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    minWidth: 120,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.xl,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  text: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
  },
});
