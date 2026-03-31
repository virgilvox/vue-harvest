<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps({
  placeholder: {
    type: String,
    default: undefined,
  },
  modelValue: {
    type: String,
    required: true,
  },
})

const emit = defineEmits(['update:modelValue', 'search'])

const localValue = ref(props.modelValue)

function handleSearch() {
  emit('update:modelValue', localValue.value)
  emit('search', localValue.value)
}
</script>

<template>
  <div class="search-bar">
    <input
      v-model="localValue"
      :placeholder="placeholder ?? t('search.placeholder')"
      class="search-input"
      @keydown.enter="handleSearch"
    />
    <button class="search-btn" @click="handleSearch">
      {{ t('search.button') }}
    </button>
  </div>
</template>

<style scoped>
.search-bar {
  display: flex;
  gap: 8px;
}

.search-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
}

.search-btn {
  padding: 8px 16px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
</style>
