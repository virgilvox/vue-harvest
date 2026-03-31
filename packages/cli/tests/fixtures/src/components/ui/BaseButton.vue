<script setup lang="ts">
defineProps<{
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  loading?: boolean
}>()

defineEmits<{
  (e: 'click', event: MouseEvent): void
}>()
</script>

<template>
  <button
    :class="['btn', `btn--${variant ?? 'primary'}`, `btn--${size ?? 'md'}`]"
    :disabled="disabled || loading"
    @click="$emit('click', $event)"
  >
    <span v-if="loading" class="spinner" />
    <slot />
  </button>
</template>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border-radius: 6px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn--primary {
  background: #3b82f6;
  color: #ffffff;
  border: none;
}

.btn--secondary {
  background: transparent;
  color: #3b82f6;
  border: 1px solid #3b82f6;
}

.btn--ghost {
  background: transparent;
  color: #6b7280;
  border: none;
}

.btn--sm { padding: 4px 12px; font-size: 14px; }
.btn--md { padding: 8px 16px; font-size: 16px; }
.btn--lg { padding: 12px 24px; font-size: 18px; }

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
