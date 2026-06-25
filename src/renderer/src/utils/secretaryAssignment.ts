/**
 * 秘书随机分配管理
 * 同一会话中，同一 agent type 保持一致的 Lily/Mary 分配
 */

export type SecretaryType = 'lily' | 'mary'

const secretaryAssignments = new Map<string, SecretaryType>()

/**
 * 根据 agent type 获取对应的秘书（Lily 或 Mary）
 * 同一 type 在同一会话中保持一致
 */
export function getSecretaryForType(type: string): SecretaryType {
  if (secretaryAssignments.has(type)) {
    return secretaryAssignments.get(type)!
  }
  // 随机分配
  const secretary: SecretaryType = Math.random() < 0.5 ? 'lily' : 'mary'
  secretaryAssignments.set(type, secretary)
  return secretary
}

/**
 * 清空分配记录（用于切换会话时重置）
 */
export function clearSecretaryAssignments(): void {
  secretaryAssignments.clear()
}
