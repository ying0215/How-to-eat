import React from 'react';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { theme } from '../../constants/theme';
import { useThemeColors } from '../../contexts/ThemeContext';

interface LoaderProps {
    message?: string;
    fullScreen?: boolean;
}

export const Loader: React.FC<LoaderProps> = ({ message, fullScreen = false }) => {
    const colors = useThemeColors();
    return (
        <View style={[
            styles.container,
            fullScreen && [styles.fullScreen, { backgroundColor: colors.background }],
        ]}>
            <ActivityIndicator size="large" color={colors.primary} />
            {message && <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text>}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        justifyContent: 'center',
        padding: theme.spacing.lg,
    },
    fullScreen: {
        flex: 1,
    },
    message: {
        marginTop: theme.spacing.md,
        ...theme.typography.body,
    },
});
