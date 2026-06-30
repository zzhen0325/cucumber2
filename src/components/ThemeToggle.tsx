import { DarkThemeIcon as ThemeIcon } from "@proicons/react";

import { useTheme } from "@/components/theme-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { isThemeName, THEME_OPTIONS } from "@/lib/theme";

type ThemeToggleProps = {
  align?: "start" | "center" | "end";
  buttonClassName?: string;
  className?: string;
  showLabel?: boolean;
  side?: "top" | "right" | "bottom" | "left";
};

export function ThemeToggle({
  align = "end",
  buttonClassName,
  className,
  showLabel = false,
  side = "bottom",
}: ThemeToggleProps) {
  const { setTheme, theme } = useTheme();
  const selectedTheme = THEME_OPTIONS.find((option) => option.value === theme);
  const label = `${selectedTheme?.label ?? theme}主题`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`切换主题，当前${label}`}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-round border-0 bg-transparent text-text-muted transition-colors hover:bg-surface-warm hover:text-text",
            showLabel
              ? "min-h-[48px] min-w-[48px] flex-col px-2 py-1.5 text-[10px] font-medium leading-none"
              : "size-9",
            buttonClassName
          )}
          title="主题"
          type="button"
        >
          <ThemeIcon className="size-5" />
          {showLabel && <span>主题</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className={cn("min-w-28", className)}
        side={side}
      >
        <DropdownMenuLabel>主题</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => {
            if (isThemeName(value)) {
              setTheme(value);
            }
          }}
        >
          {THEME_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
