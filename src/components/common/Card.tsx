import React from 'react';
import { Platform, View, StyleSheet, ViewProps } from 'react-native';
import { theme } from '../../constants/theme';

interface CardProps extends ViewProps {
    children: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({ children, style, ...props }) => {
    return (
        <View style={[styles.card, platformShadow, style]} {...props}>
            {children}
        </View>
    );
};

// ── 跨平台陰影 ──
// Web：使用 boxShadow（避免 shadow* 棄用警告）
// Android：使用 elevation
// iOS：使用原生 shadow* props
const platformShadow: any =
    Platform.OS === 'web'
        ? { boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.1)' }
        : Platform.OS === 'android'
            ? { elevation: 3 }
            : {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.1,
                shadowRadius: 8,
            };

const styles = StyleSheet.create({
    card: {
        backgroundColor: theme.colors.surface,
        borderRadius: theme.borderRadius.lg,
        padding: theme.spacing.md,
        marginVertical: theme.spacing.sm,
    }
});
