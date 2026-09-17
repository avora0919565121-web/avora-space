import { ChevronRight, FolderKanban, Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { projectLink, type Project } from "@/lib/projects";
import { cn } from "@/lib/utils";

/**
 * The projects living in this conversation, as their own strip above the thread.
 *
 * Deliberately NOT part of the pinned-messages strip. A pin says "read this line again"; a
 * project says "this is what we are building". Folding them together would mean one collapse
 * hides both, and the count on the strip could no longer be trusted to mean either.
 */
export function ProjectStrip({
  projects,
  onNewProject,
  canCreate,
}: {
  projects: readonly Project[];
  onNewProject: () => void;
  /** False in a thread the viewer has left: reading stays, opening does not. */
  canCreate: boolean;
}) {
  const [isOpen, setIsOpen] = useState<boolean>(false);

  if (projects.length === 0) return null;

  return (
    <section
      aria-label="Dự án của cuộc trò chuyện"
      className="border-b border-border bg-primary/[0.04] px-5 py-2 md:px-10"
    >
      <div className="mx-auto max-w-2xl">
        <button
          type="button"
          onClick={() => setIsOpen((current) => !current)}
          aria-expanded={isOpen}
          className="press flex w-full items-center gap-2 text-left"
        >
          <ChevronRight
            aria-hidden="true"
            strokeWidth={2.2}
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
              isOpen && "rotate-90",
            )}
          />
          <span aria-hidden="true" className="text-[13px] leading-none">
            📁
          </span>
          <span className="text-[12.5px] font-semibold text-foreground">Dự án</span>
          <span className="tabular text-[11.5px] text-muted-foreground">{projects.length}</span>
          {!isOpen ? (
            <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
              {projects[0].title}
              {projects.length > 1 ? ` +${projects.length - 1}` : ""}
            </span>
          ) : null}
        </button>

        {isOpen ? (
          <ul className="mt-1.5 space-y-0.5 pb-0.5">
            {projects.map((project) => (
              <li key={project.id}>
                <Link
                  to={projectLink(project.id)}
                  className="press flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-accent/40"
                >
                  <FolderKanban
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    strokeWidth={1.8}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                    {project.title}
                  </span>
                </Link>
              </li>
            ))}
            {canCreate ? (
              <li>
                <button
                  type="button"
                  onClick={onNewProject}
                  className="press flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent/40"
                >
                  <Plus
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    strokeWidth={2.1}
                    aria-hidden="true"
                  />
                  <span className="text-[13px] text-muted-foreground">Dự án mới ở đây</span>
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
