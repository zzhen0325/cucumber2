import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-[12px] text-[14px] font-normal leading-[22px] tracking-normal whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:pointer-events-none disabled:opacity-45 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary-hover hover:shadow-primary-hover active:bg-primary-active",
        destructive:
          "bg-destructive text-danger-foreground hover:bg-destructive/90 focus-visible:ring-destructive/20",
        outline:
          "border border-primary bg-transparent text-primary shadow-none hover:bg-primary/8 hover:text-primary-text-hover",
        secondary:
          "bg-secondary text-secondary-foreground shadow-none hover:bg-secondary-hover",
        ghost:
          "bg-ghost text-primary shadow-none hover:bg-ghost-hover hover:text-primary-text-hover",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-[12.5px] py-[8.5px] has-[>svg]:px-[12.5px]",
        xs: "h-8 gap-1.5 px-[10.5px] py-[6.5px] text-[13px] leading-[20px] has-[>svg]:px-[10.5px] [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-9 px-[12.5px] py-[8.5px] has-[>svg]:px-[12.5px]",
        lg: "h-10 px-4 py-2 text-[14px] leading-[22px] has-[>svg]:px-4",
        icon: "size-9 rounded-[12px]",
        "icon-xs": "size-7 rounded-[10px] [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-8 rounded-[12px]",
        "icon-lg": "size-10 rounded-[14px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
