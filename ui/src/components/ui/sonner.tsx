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
            "--width": "320px",
          } as React.CSSProperties
        }
        toastOptions={{
          classNames: {
            toast:
              "cn-toast group/toast cursor-pointer !items-center !gap-3 !rounded-xl !border-border/70 !bg-popover/95 !py-2.5 !ps-2.5 !pe-9 !text-popover-foreground !shadow-lg !shadow-black/10 backdrop-blur-md",
            title: "!text-[13px] !font-medium !leading-snug",
            description: "!text-xs text-muted-foreground",
            icon: "!m-0 !grid !size-7 shrink-0 place-items-center rounded-full bg-muted",
            closeButton:
              "!start-auto !end-1.5 !top-1/2 ![transform:translateY(-50%)] !size-6 !border-0 !bg-transparent !text-muted-foreground opacity-0 transition-opacity group-hover/toast:opacity-100 hover:!bg-muted",
            // Only the icon carries the kind, in a tint readable in both themes.
            success: "[&_[data-icon]]:bg-emerald-500/15 [&_[data-icon]]:text-emerald-600 dark:[&_[data-icon]]:text-emerald-400",
            info: "[&_[data-icon]]:bg-sky-500/15 [&_[data-icon]]:text-sky-600 dark:[&_[data-icon]]:text-sky-400",
            warning: "[&_[data-icon]]:bg-amber-500/15 [&_[data-icon]]:text-amber-600 dark:[&_[data-icon]]:text-amber-400",
            error: "[&_[data-icon]]:bg-rose-500/15 [&_[data-icon]]:text-rose-600 dark:[&_[data-icon]]:text-rose-400",
            loading: "[&_[data-icon]]:text-primary",
            actionButton: "!bg-primary !text-primary-foreground",
          },
        }}
        expand
        gap={8}
        closeButton
        {...props}
      />
    </div>
  )
}

export { Toaster }
