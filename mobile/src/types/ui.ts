import type { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

export type IconName = ComponentProps<typeof Ionicons>['name'];

/** Colour tone of a status pill. */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
