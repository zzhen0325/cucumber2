import { motion } from "framer-motion";

import { cucumberLogo } from "@/components/icons/cucumber-logo";
import { cn } from "@/lib/utils";

export type WorkspaceView = "home" | "projects";

type NavItem = {
  view: WorkspaceView;
  label: string;
  /** SVG path `d` attribute */
  icon: string;
  /** Square viewBox dimension, e.g. 20 -> "0 0 20 20" */
  viewBox: number;
};

const NAV_ITEMS: NavItem[] = [
  {
    view: "home",
    label: "主页",
    viewBox: 20,
    icon: "M8.69 2.136a2 2 0 0 1 2.62 0l5.655 4.905A3 3 0 0 1 18 9.307v7.194a1.5 1.5 0 0 1-1.5 1.5h-3c-.777 0-1.415-.59-1.493-1.347L12 16.501v-5.188a.6.6 0 0 0-.48-.588l-.12-.011H8.6a.6.6 0 0 0-.6.6V16.5A1.5 1.5 0 0 1 6.5 18h-3A1.5 1.5 0 0 1 2 16.5V9.307c0-.815.332-1.593.915-2.157l.119-.11zm1.769.983a.7.7 0 0 0-.918 0L3.886 8.023A1.7 1.7 0 0 0 3.3 9.307v7.194c0 .11.09.2.2.2h3a.2.2 0 0 0 .2-.2v-5.188a1.9 1.9 0 0 1 1.9-1.9H11.4c1.05.001 1.9.851 1.9 1.9v5.188c0 .11.09.2.2.2h3a.2.2 0 0 0 .2-.2V9.307a1.7 1.7 0 0 0-.587-1.284z",
  },
  {
    view: "projects",
    label: "项目",
    viewBox: 20,
    icon: "M8.968 2.004c.69.038 1.337.361 1.782.895l1 1.201c.138.166.335.27.548.294l.092.006h3.087A2.523 2.523 0 0 1 18 6.923v8.554l-.013.258a2.524 2.524 0 0 1-2.252 2.252l-.258.013H4.522a2.524 2.524 0 0 1-2.51-2.265L2 15.477V4.522A2.523 2.523 0 0 1 4.522 2H8.83zM3.3 15.477c0 .675.547 1.223 1.222 1.223h10.955c.675 0 1.223-.548 1.223-1.223V9.4H3.3zM4.522 3.3c-.674 0-1.222.547-1.222 1.222V8.1h13.4V6.923c0-.675-.547-1.223-1.223-1.223H12.39a2.14 2.14 0 0 1-1.64-.768l-1-1.2A1.2 1.2 0 0 0 8.83 3.3z",
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
      <aside className="hidden h-screen w-[60px] flex-col items-center gap-1 border-r border-border bg-card py-3 md:flex">
        <div className="mb-1 flex h-9 w-9 items-center justify-center">
          <motion.div
            whileHover={{ scale: 1.1, rotate: 8 }}
            whileTap={{ scale: 0.9 }}
            transition={{ type: "spring", stiffness: 400, damping: 17 }}
          >
            <cucumberLogo className="size-7 text-foreground" />
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

        <button
          type="button"
          onClick={() => void onLogout()}
          title="退出登录"
          aria-label="退出登录"
          className="flex h-9 w-9 items-center justify-center rounded-full"
        >
          <motion.svg
            viewBox="0 0 20 20"
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5 text-muted-foreground"
            whileHover={{ scale: 1.15 }}
            whileTap={{ scale: 0.9 }}
            transition={{ type: "spring", stiffness: 400, damping: 17 }}
          >
            <path
              d="M3 4.5A2.5 2.5 0 0 1 5.5 2h5A2.5 2.5 0 0 1 13 4.5v1a.5.5 0 0 1-1 0v-1A1.5 1.5 0 0 0 10.5 3h-5A1.5 1.5 0 0 0 4 4.5v11A1.5 1.5 0 0 0 5.5 17h5a1.5 1.5 0 0 0 1.5-1.5v-1a.5.5 0 0 1 1 0v1A2.5 2.5 0 0 1 10.5 18h-5A2.5 2.5 0 0 1 3 15.5zm12.354-1.354a.5.5 0 0 0-.708.708L16.793 6H7.5a.5.5 0 0 0 0 1h9.293l-2.147 2.146a.5.5 0 0 0 .708.708l3-3a.5.5 0 0 0 0-.708z"
              transform="translate(0, 4)"
            />
          </motion.svg>
        </button>
      </aside>

      {/* Mobile bottom navigation bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm md:hidden"
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
                active ? "text-foreground" : "text-muted-foreground"
              )}
            >
              <svg
                viewBox={`0 0 ${item.viewBox} ${item.viewBox}`}
                fill="currentColor"
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
              >
                <path d={item.icon} />
              </svg>
              <span className="text-[10px] font-medium leading-none">
                {item.label}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => void onLogout()}
          aria-label="退出登录"
          className="flex min-h-[48px] min-w-[48px] flex-col items-center justify-center gap-0.5 px-2 py-1.5 text-muted-foreground transition-colors"
        >
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
          >
            <path
              d="M3 4.5A2.5 2.5 0 0 1 5.5 2h5A2.5 2.5 0 0 1 13 4.5v1a.5.5 0 0 1-1 0v-1A1.5 1.5 0 0 0 10.5 3h-5A1.5 1.5 0 0 0 4 4.5v11A1.5 1.5 0 0 0 5.5 17h5a1.5 1.5 0 0 0 1.5-1.5v-1a.5.5 0 0 1 1 0v1A2.5 2.5 0 0 1 10.5 18h-5A2.5 2.5 0 0 1 3 15.5zm12.354-1.354a.5.5 0 0 0-.708.708L16.793 6H7.5a.5.5 0 0 0 0 1h9.293l-2.147 2.146a.5.5 0 0 0 .708.708l3-3a.5.5 0 0 0 0-.708z"
              transform="translate(0, 4)"
            />
          </svg>
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
          className="absolute inset-0 rounded-full border-l-2 border-primary bg-primary/10"
          transition={{ type: "spring", stiffness: 350, damping: 30 }}
        />
      )}
      <motion.svg
        viewBox={`0 0 ${item.viewBox} ${item.viewBox}`}
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
        className={cn(
          "relative h-5 w-5",
          active ? "text-foreground" : "text-muted-foreground"
        )}
        whileHover={{ scale: 1.15 }}
        whileTap={{ scale: 0.9 }}
        transition={{ type: "spring", stiffness: 400, damping: 17 }}
      >
        <path d={item.icon} />
      </motion.svg>
    </button>
  );
}
