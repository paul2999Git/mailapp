import { useState, useEffect, useRef, ReactNode } from 'react';
import './ContextMenu.css';

export interface ContextMenuItem {
    label?: string;
    icon?: ReactNode;
    onClick?: () => void;
    items?: ContextMenuItem[];
    divider?: boolean;
    danger?: boolean;
}

interface ContextMenuProps {
    x: number;
    y: number;
    items: ContextMenuItem[];
    onClose: () => void;
}

export const ContextMenu = ({ x, y, items, onClose }: ContextMenuProps) => {
    const menuRef = useRef<HTMLDivElement>(null);
    const [activeSubMenu, setActiveSubMenu] = useState<number | null>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose();
            }
        };

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };

        document.addEventListener('click', handleClickOutside);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('click', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [onClose]);

    // Adjust position if menu goes off screen
    const [adjustedPos, setAdjustedPos] = useState({ x, y });

    useEffect(() => {
        if (menuRef.current) {
            const rect = menuRef.current.getBoundingClientRect();
            const winW = window.innerWidth;
            const winH = window.innerHeight;

            let nx = x;
            let ny = y;

            if (x + rect.width > winW) nx = winW - rect.width - 10;
            if (y + rect.height > winH) ny = winH - rect.height - 10;

            setAdjustedPos({ x: nx, y: ny });
        }
    }, [x, y]);

    return (
        <div
            ref={menuRef}
            className="context-menu"
            onWheel={(e) => e.stopPropagation()}
            style={{
                top: adjustedPos.y,
                left: adjustedPos.x,
            }}
        >
            {items.map((item, index) => {
                if (item.divider) {
                    return <div key={index} className="context-menu-divider" />;
                }

                const hasSubMenu = item.items && item.items.length > 0;

                return (
                    <div
                        key={index}
                        className={`context-menu-item ${item.danger ? 'danger' : ''} ${hasSubMenu ? 'has-submenu' : ''}`}
                        onMouseEnter={() => hasSubMenu && setActiveSubMenu(index)}
                        onMouseLeave={() => hasSubMenu && setActiveSubMenu(null)}
                        onClick={() => {
                            if (!hasSubMenu && item.onClick) {
                                item.onClick();
                                onClose();
                            }
                        }}
                    >
                        <div className="context-menu-item-main">
                            {item.icon && <span className="icon">{item.icon}</span>}
                            <span>{item.label}</span>
                            {hasSubMenu && <span className="arrow">▶</span>}
                        </div>

                        {hasSubMenu && activeSubMenu === index && (
                            <div
                                className="context-submenu"
                                onWheel={(e) => e.stopPropagation()}
                                onContextMenu={(e) => e.stopPropagation()}
                            >
                                {item.items!.map((subItem, sIndex) => (
                                    <div
                                        key={sIndex}
                                        className="context-menu-item"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (subItem.onClick) {
                                                subItem.onClick();
                                                onClose();
                                            }
                                        }}
                                    >
                                        <div className="context-menu-item-main">
                                            {subItem.icon && <span className="icon">{subItem.icon}</span>}
                                            <span>{subItem.label}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};
