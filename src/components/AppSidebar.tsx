import { motion } from "framer-motion";
import {
  FolderIcon as Folder,
  HomeIcon as Home,
  ArrowExportIcon as LogOut,
  SparkleIcon as Sparkles,
} from "@proicons/react";

type IconComponent = typeof Home;

import { CucumberLogo } from "@/components/icons/cucumber-logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";

export type WorkspaceView = "home" | "projects" | "skills";

type NavItem = {
  view: WorkspaceView;
  label: string;
  icon: IconComponent;
};

const NAV_ITEMS: NavItem[] = [
  {
    view: "home",
    label: "主页",
    icon: Home,
  },
  {
    view: "projects",
    label: "项目",
    icon: Folder,
  },
  {
    view: "skills",
    label: "技能",
    icon: Sparkles,
  },
];

type AppSidebarProps = {
  view: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
  onLogout: () => Promise<void>;
};

export function AppSidebar({ view, onViewChange, onLogout }: AppSidebarProps) {
  return (
    <>
      {/* Desktop sidebar rail */}
      <aside className="hidden h-screen w-[60px] flex-col items-center gap-1 border-r border-border bg-surface py-3 md:flex">
        <div className="mb-1 flex h-9 w-9 items-center justify-center">
          <motion.div
            whileHover={{ scale: 1.1, rotate: 8 }}
            whileTap={{ scale: 0.9 }}
            transition={{ type: "spring", stiffness: 400, damping: 17 }}
          >
            <CucumberLogo className="size-7 text-text" />
          </motion.div>
        </div>

        {NAV_ITEMS.map((item) => (
          <NavButton
            key={item.view}
            item={item}
            active={view === item.view}
            onSelect={() => onViewChange(item.view)}
          />
        ))}

        <div className="flex-1" />

        <ThemeToggle
          buttonClassName="h-9 w-9 rounded-round"
          side="right"
          align="center"
        />

        <button
          type="button"
          onClick={() => void onLogout()}
          title="退出登录"
          aria-label="退出登录"
          className="flex h-9 w-9 items-center justify-center rounded-full"
        >
          <motion.span
            className="h-5 w-5 text-text-muted"
            whileHover={{ scale: 1.15 }}
            whileTap={{ scale: 0.9 }}
            transition={{ type: "spring", stiffness: 400, damping: 17 }}
          >
            <LogOut className="size-5" />
          </motion.span>
        </button>
      </aside>

      {/* Mobile bottom navigation bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm md:hidden"
        aria-label="主导航"
      >
        {NAV_ITEMS.map((item) => {
          const active = view === item.view;
          return (
            <button
              key={item.view}
              type="button"
              onClick={() => onViewChange(item.view)}
              aria-label={item.label}
              className={cn(
                "flex min-h-[48px] min-w-[48px] flex-col items-center justify-center gap-0.5 px-2 py-1.5 transition-colors",
                active ? "text-text" : "text-text-muted"
              )}
            >
              <item.icon className="h-5 w-5" />
              <span className="text-[10px] font-medium leading-none">
                {item.label}
              </span>
            </button>
          );
        })}
        <ThemeToggle
          align="center"
          buttonClassName="rounded-none hover:bg-transparent"
          showLabel
          side="top"
        />
        <button
          type="button"
          onClick={() => void onLogout()}
          aria-label="退出登录"
          className="flex min-h-[48px] min-w-[48px] flex-col items-center justify-center gap-0.5 px-2 py-1.5 text-text-muted transition-colors"
        >
          <LogOut className="h-5 w-5" />
          <span className="text-[10px] font-medium leading-none">退出</span>
        </button>
      </nav>
    </>
  );
}

function NavButton({
  item,
  active,
  onSelect,
}: {
  item: NavItem;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = item.icon;

  return (
    <button
      type="button"
      onClick={onSelect}
      title={item.label}
      aria-label={item.label}
      className="relative flex h-9 w-9 items-center justify-center rounded-full"
    >
      {active && (
        <motion.span
          layoutId="sidebar-active"
          className="absolute inset-0 rounded-full bg-primary-surface"
          transition={{ type: "spring", stiffness: 350, damping: 30 }}
        />
      )}
      <motion.span
        className={cn(
          "relative h-5 w-5",
          active ? "text-text" : "text-text-muted"
        )}
        whileHover={{ scale: 1.15 }}
        whileTap={{ scale: 0.9 }}
        transition={{ type: "spring", stiffness: 400, damping: 17 }}
      >
        <Icon className="size-5" />
      </motion.span>
    </button>
  );
}
