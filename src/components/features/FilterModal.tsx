import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, ScrollView, Pressable } from 'react-native';
import { Button } from '../common/Button';
import { theme } from '../../constants/theme';
import { Ionicons } from '@expo/vector-icons';
import { CATEGORY_LABELS } from '../../constants/categories';

export interface FilterOptions {
    category?: string;
    maxDistance?: number; // meters
    priceLevel?: 1 | 2 | 3 | 4;
}

interface FilterModalProps {
    visible: boolean;
    onClose: () => void;
    onApply: (filters: FilterOptions) => void;
    initialFilters?: FilterOptions;
}


const DISTANCES: { label: string; value: number | null }[] = [
    { label: '500m 以內', value: 500 },
    { label: '1km 以內', value: 1000 },
    { label: '3km 以內', value: 3000 },
    { label: '不限距離', value: null },
];

export const FilterModal: React.FC<FilterModalProps> = ({
    visible,
    onClose,
    onApply,
    initialFilters = {}
}) => {
    const [selectedCategory, setSelectedCategory] = useState<string>(initialFilters.category || '全部');
    const [selectedDistance, setSelectedDistance] = useState<number | null>(initialFilters.maxDistance ?? null);

    // Bug #4 修正：當 Modal 重新打開時，同步 initialFilters 到內部 state
    // 確保使用者看到的是上次套用的篩選條件，而非首次渲染的初始值
    useEffect(() => {
        if (visible) {
            setSelectedCategory(initialFilters.category || '全部');
            setSelectedDistance(initialFilters.maxDistance ?? null);
        }
    }, [visible, initialFilters.category, initialFilters.maxDistance]);

    const handleApply = () => {
        onApply({
            category: selectedCategory === '全部' ? undefined : selectedCategory,
            maxDistance: selectedDistance ?? undefined,
        });
        onClose();
    };

    const handleReset = () => {
        setSelectedCategory('全部');
        setSelectedDistance(null);
    };

    return (
        <Modal
            visible={visible}
            animationType="slide"
            transparent={true}
            onRequestClose={onClose}
        >
            <View style={styles.modalOverlay}>
                <View style={styles.modalContent}>
                    <View style={styles.header}>
                        <Text style={styles.title}>篩選條件</Text>
                        <Pressable
                            onPress={onClose}
                            style={({ pressed }) => pressed && { opacity: theme.interaction.pressedOpacity }}
                        >
                            <Ionicons name="close" size={24} color={theme.colors.text} />
                        </Pressable>
                    </View>

                    <ScrollView style={styles.scrollArea}>
                        <Text style={styles.sectionTitle}>餐廳種類</Text>
                        <View style={styles.chipContainer}>
                            {CATEGORY_LABELS.map(cat => (
                                <Pressable
                                    key={cat}
                                    style={({ pressed }) => [
                                        styles.chip,
                                        selectedCategory === cat && styles.chipSelected,
                                        pressed && { opacity: theme.interaction.pressedOpacity },
                                    ]}
                                    onPress={() => setSelectedCategory(cat)}
                                >
                                    <Text style={[
                                        styles.chipText,
                                        selectedCategory === cat && styles.chipTextSelected
                                    ]}>
                                        {cat}
                                    </Text>
                                </Pressable>
                            ))}
                        </View>

                        <Text style={styles.sectionTitle}>距離範圍</Text>
                        <View style={styles.chipContainer}>
                            {DISTANCES.map(dist => (
                                <Pressable
                                    key={dist.label}
                                    style={({ pressed }) => [
                                        styles.chip,
                                        selectedDistance === dist.value && styles.chipSelected,
                                        pressed && { opacity: theme.interaction.pressedOpacity },
                                    ]}
                                    onPress={() => setSelectedDistance(dist.value)}
                                >
                                    <Text style={[
                                        styles.chipText,
                                        selectedDistance === dist.value && styles.chipTextSelected
                                    ]}>
                                        {dist.label}
                                    </Text>
                                </Pressable>
                            ))}
                        </View>

                        {/* 價位考量未來可再擴充 */}

                    </ScrollView>

                    <View style={styles.footer}>
                        <Button
                            label="重設"
                            variant="secondary"
                            onPress={handleReset}
                            style={styles.footerButton}
                        />
                        <Button
                            label="套用篩選"
                            onPress={handleApply}
                            style={styles.footerButton}
                        />
                    </View>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    modalOverlay: {
        flex: 1,
        backgroundColor: theme.colors.overlay,
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: theme.colors.surface,
        borderTopLeftRadius: theme.borderRadius.xl,
        borderTopRightRadius: theme.borderRadius.xl,
        minHeight: '60%',
        maxHeight: '90%',
        paddingBottom: theme.spacing.xl, // Safe area for iOS
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: theme.spacing.lg,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
    },
    title: {
        ...theme.typography.h3,
        fontSize: 20,
        fontWeight: 'bold',
        color: theme.colors.text,
    },
    scrollArea: {
        padding: theme.spacing.lg,
    },
    sectionTitle: {
        ...theme.typography.body,
        fontWeight: 'bold',
        color: theme.colors.text,
        marginBottom: theme.spacing.md,
        marginTop: theme.spacing.sm,
    },
    chipContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: theme.spacing.sm,
        marginBottom: theme.spacing.lg,
    },
    chip: {
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        borderRadius: theme.borderRadius.full,
        backgroundColor: theme.colors.background,
        borderWidth: 1,
        borderColor: theme.colors.border,
    },
    chipSelected: {
        backgroundColor: theme.colors.primary,
        borderColor: theme.colors.primary,
    },
    chipText: {
        ...theme.typography.bodySmall,
        color: theme.colors.textSecondary,
    },
    chipTextSelected: {
        color: theme.colors.onPrimary,
        fontWeight: 'bold',
    },
    footer: {
        flexDirection: 'row',
        padding: theme.spacing.lg,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        gap: theme.spacing.md,
    },
    footerButton: {
        flex: 1,
    }
});
