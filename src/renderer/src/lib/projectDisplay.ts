type Translator = (key: string, options?: Record<string, unknown>) => string

const DEFAULT_PROJECT_TRANSLATION_KEYS: Record<string, string> = {
  'release-009': 'release009',
  'sidebar-refine': 'sidebarRefine',
  'skills-onboarding': 'skillsOnboarding',
}

function getDefaultProjectTranslationKey(projectId: string): string | null {
  return DEFAULT_PROJECT_TRANSLATION_KEYS[projectId] || null
}

export function getProjectDisplayName(
  project: { project_id: string; name: string },
  t: Translator,
): string {
  const translationKey = getDefaultProjectTranslationKey(project.project_id)
  return translationKey ? t(`projects.defaults.${translationKey}.name`) : project.name
}

export function getProjectDisplayDescription(
  project: { project_id: string; description: string },
  t: Translator,
): string {
  const translationKey = getDefaultProjectTranslationKey(project.project_id)
  return translationKey ? t(`projects.defaults.${translationKey}.description`) : project.description
}
