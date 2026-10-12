import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  // A click anywhere on a toast closes it, like its close button; its own buttons keep working.
  const closeOnClick = (event: React.MouseEvent) => {
    const target = event.target as HTMLElement
    if (target.closest("button, a")) return
    target.closest("[data-sonner-toast]")?.querySelector<HTMLButtonElement>("[data-close-button]")?.click()
  }

  return (
    <div className="contents" onClick={closeOnClick}>
      <Sonner
        theme={theme as ToasterProps["theme"]}
        className="toaster group"
        icons={{
          success: (
            <CircleCheckIcon className="size-4" />
          ),
          info: (
            <InfoIcon className="size-4" />
          ),
          warning: (
            <TriangleAlertIcon className="size-4" />
          ),
          error: (
            <OctagonXIcon className="size-4" />
          ),
          loading: (
            <Loader2Icon className="size-4 animate-spin" />
          ),
        }}
        style={
          {
            "--normal-bg": "var(--popover)",
            "--normal-text": "var(--popover-foreground)",
            "--normal-border": "var(--border)",
            "--border-radius": "var(--radius)",
          } as React.CSSProperties
        }
        toastOptions={{
          classNames: {
            toast: "cn-toast cursor-pointer",
            description: "opacity-90",
            // A tint per kind, readable in both themes; the default toast keeps the popover colours.
            success:
              "!border-emerald-500/40 !bg-emerald-50 !text-emerald-950 dark:!bg-emerald-950 dark:!text-emerald-50 [&_[data-icon]]:text-emerald-600 dark:[&_[data-icon]]:text-emerald-400",
            info: "!border-sky-500/40 !bg-sky-50 !text-sky-950 dark:!bg-sky-950 dark:!text-sky-50 [&_[data-icon]]:text-sky-600 dark:[&_[data-icon]]:text-sky-400",
            warning:
              "!border-amber-500/50 !bg-amber-50 !text-amber-950 dark:!bg-amber-950 dark:!text-amber-50 [&_[data-icon]]:text-amber-600 dark:[&_[data-icon]]:text-amber-400",
            error:
              "!border-rose-500/50 !bg-rose-50 !text-rose-950 dark:!bg-rose-950 dark:!text-rose-50 [&_[data-icon]]:text-rose-600 dark:[&_[data-icon]]:text-rose-400",
            loading: "[&_[data-icon]]:text-primary",
            actionButton: "!bg-primary !text-primary-foreground",
          },
        }}
        closeButton
        {...props}
      />
    </div>
  )
}

export { Toaster }
