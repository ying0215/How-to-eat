import React from 'react';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { theme } from '../../constants/theme';

interface LoaderProps {
    message?: string;
    fullScreen?: boolean;
}

export const Loader: React.FC<LoaderProps> = ({ message, fullScreen = false }) => {
    return (
        <View style={[styles.container, fullScreen && styles.fullScreen]}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            {message && <Text style={styles.message}>{message}</Text>}
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
        backgroundColor: theme.colors.background,
    },
    message: {
        marginTop: theme.spacing.md,
        color: theme.colors.textSecondary,
        ...theme.typography.body,
    }
});
