<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useUserStore } from '@/stores/userStore'
import UserProfileCard from '@/components/features/UserProfileCard.vue'
import BaseCard from '@/components/ui/BaseCard.vue'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()

const stats = ref<any>(null)

onMounted(async () => {
  const response = await fetch('/api/dashboard/stats')
  stats.value = await response.json()
})
</script>

<template>
  <div class="dashboard">
    <h1>Dashboard</h1>
    <div class="grid">
      <UserProfileCard />
      <BaseCard title="Stats">
        <pre>{{ stats }}</pre>
      </BaseCard>
    </div>
  </div>
</template>

<style>
.dashboard {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}

.dashboard h1 {
  font-size: 24px;
  font-weight: 700;
  margin-bottom: 24px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}
</style>
