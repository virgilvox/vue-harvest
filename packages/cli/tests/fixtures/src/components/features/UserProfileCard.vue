<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/userStore'
import BaseCard from '../ui/BaseCard.vue'
import BaseButton from '../ui/BaseButton.vue'

const router = useRouter()
const userStore = useUserStore()

const user = computed(() => userStore.currentUser)

function handleEdit() {
  router.push(`/users/${user.value?.id}/edit`)
}
</script>

<template>
  <BaseCard :title="user?.name" elevated>
    <div class="profile">
      <img :src="user?.avatar" :alt="user?.name" class="avatar" />
      <p class="email">{{ user?.email }}</p>
      <p class="role">{{ user?.role }}</p>
    </div>
    <template #footer>
      <BaseButton variant="secondary" @click="handleEdit">
        Edit Profile
      </BaseButton>
    </template>
  </BaseCard>
</template>

<style scoped>
.profile {
  text-align: center;
}

.avatar {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  margin-bottom: 12px;
}

.email {
  color: #6b7280;
  font-size: 14px;
}

.role {
  color: #9ca3af;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
</style>
