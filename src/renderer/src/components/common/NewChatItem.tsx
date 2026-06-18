import { useTranslation } from 'react-i18next'

// 新建会话项 - 使用国际化文字
export function NewChatItem({ className }: { className?: string }) {
  const { t } = useTranslation()

  return (
    <span
      className={className}
      style={{
        fontFamily: 'Source Han Sans CN',
        fontSize: '14px',
        fontWeight: 'normal',
        lineHeight: '24px',
        color: 'rgba(0, 0, 0, 0.8)',
        display: 'block',
        whiteSpace: 'nowrap'
      }}
    >
      {t('search.newConversation')}
    </span>
  )
}
