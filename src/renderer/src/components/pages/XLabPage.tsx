import { FlaskConical } from 'lucide-react'

/**
 * Placeholder landing page for the X·LAB sidebar entry.
 *
 * The X·LAB area is intended to host experimental / preview features that
 * are not yet promoted to the main product surface. Real content will be
 * added in subsequent iterations; for now this page only renders a brief
 * description so the route resolves cleanly when users click the sidebar
 * item.
 */
export function XLabPage() {
  return (
    <div className="flex h-full items-center justify-center px-8">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <FlaskConical size={26} strokeWidth={1.8} />
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">X·LAB</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          实验场。即将上线的实验性功能与早期预览会陆续在这里出现，敬请期待。
        </p>
      </div>
    </div>
  )
}
