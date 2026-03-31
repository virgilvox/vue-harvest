<script setup lang="ts">
defineProps<{
  modelValue: string
  label?: string
  placeholder?: string
  type?: 'text' | 'email' | 'password' | 'number'
  error?: string
  disabled?: boolean
}>()

defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'blur'): void
}>()
</script>

<template>
  <div class="input-group">
    <label v-if="label" class="input-label">{{ label }}</label>
    <input
      :value="modelValue"
      :type="type ?? 'text'"
      :placeholder="placeholder"
      :disabled="disabled"
      :class="['input', { 'input--error': error }]"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      @blur="$emit('blur')"
    />
    <span v-if="error" class="input-error">{{ error }}</span>
  </div>
</template>

<style scoped>
.input-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.input-label {
  font-size: 14px;
  font-weight: 500;
  color: #374151;
}

.input {
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 16px;
  transition: border-color 0.15s;
}

.input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.input--error {
  border-color: #ef4444;
}

.input-error {
  font-size: 12px;
  color: #ef4444;
}
</style>
