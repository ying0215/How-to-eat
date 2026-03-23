import React from 'react';
import { Platform, View, StyleSheet, ViewProps } from 'react-native';
import { theme } from '../../constants/theme';
import type { ThemeColors, ThemeShadows } from '../../constants/theme';
import { useThemeColors, useThemeShadows } from '../../contexts/ThemeContext';

interface CardProps extends ViewProps {
    children: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({ children, style, ...props }) => {
    const colors = useThemeColors();
    const shadows = useThemeShadows();

    // ── 跨平台陰影（動態取得 shadow 顏色）──
    const platformShadow: any =
        Platform.OS === 'web'
            ? shadows.sm
            : Platform.OS === 'android'
                ? { elevation: 3 }
                : {
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.1,
                    shadowRadius: 8,
                };

    return (
        <View
            style={[
                {
                    backgroundColor: colors.surface,
                    borderRadius: theme.borderRadius.lg,
                    padding: theme.spacing.md,
                    marginVertical: theme.spacing.sm,
                },
                platformShadow,
                style,
            ]}
            {...props}
        >
            {children}
        </View>
    );
};
