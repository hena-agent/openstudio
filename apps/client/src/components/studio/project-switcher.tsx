"use client";
import { Check, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function ProjectSwitcher({ projects, selected, disabled, onSelect }: { projects: { id: string; name: string }[]; selected: string; disabled?: boolean; onSelect: (id: string) => void }) {
  return <Popover><PopoverTrigger asChild><Button variant="outline" size="icon" disabled={disabled} aria-label="프로젝트 전환"><FolderOpen /></Button></PopoverTrigger><PopoverContent aria-label="프로젝트 목록"><div className="px-3 py-2 text-xs font-medium text-muted-foreground">프로젝트 전환</div><div className="max-h-80 overflow-y-auto">{projects.map((project) => <PopoverClose key={project.id} asChild><Button variant="ghost" disabled={disabled} className="w-full justify-between text-left" aria-current={selected === project.id ? "true" : undefined} onClick={() => onSelect(project.id)}><span className="truncate">{project.name}</span>{selected === project.id && <Check />}</Button></PopoverClose>)}{!projects.length && <p className="px-3 py-2 text-sm text-muted-foreground">생성한 프로젝트가 없습니다.</p>}</div></PopoverContent></Popover>;
}
