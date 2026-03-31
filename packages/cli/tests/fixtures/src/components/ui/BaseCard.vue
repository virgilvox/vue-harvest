<script setup lang="ts">
defineProps<{
  title?: string
  elevated?: boolean
}>()
</script>

<template>
  <div :class="['card', { 'card--elevated': elevated }]">
    <div v-if="title || $slots.header" class="card-header">
      <slot name="header">
        <h3>{{ title }}</h3>
      </slot>
    </div>
    <div class="card-body">
      <slot />
    </div>
    <div v-if="$slots.footer" class="card-footer">
      <slot name="footer" />
    </div>
  </div>
</template>

<style scoped>
.card {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
}

.card--elevated {
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.card-header {
  padding: 16px 20px;
  border-bottom: 1px solid #e5e7eb;
}

.card-header h3 {
  font-size: 18px;
  font-weight: 600;
  color: #111827;
}

.card-body {
  padding: 20px;
}

.card-footer {
  padding: 12px 20px;
  border-top: 1px solid #e5e7eb;
  background: #f9fafb;
}
</style>
