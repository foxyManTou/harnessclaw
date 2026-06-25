import { useTranslation } from 'react-i18next'

// 最近对话标签 - 使用国际化文字
export function RecentChatLabel({ className }: { className?: string }) {
  const { t } = useTranslation()

  return (
    <span
      className={className}
      style={{
        fontFamily: 'Source Han Sans CN',
        fontSize: '14px',
        fontWeight: 'normal',
        lineHeight: '30px',
        color: '#9CA3AF',
        display: 'block',
        whiteSpace: 'nowrap'
      }}
    >
      {t('search.recentConversations')}
    </span>
  )
}
