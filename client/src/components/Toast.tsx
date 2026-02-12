import * as ToastPrimitive from '@radix-ui/react-toast';
import { X } from 'lucide-react';

interface ToastProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description?: string;
    action?: {
        label: string;
        onClick: () => void;
    };
    variant?: 'default' | 'danger';
}

export const Toast = ({ open, onOpenChange, title, description, action, variant = 'default' }: ToastProps) => {
    return (
        <ToastPrimitive.Provider swipeDirection="right">
            <ToastPrimitive.Root
                className={`toast-root ${variant}`}
                open={open}
                onOpenChange={onOpenChange}
            >
                <div className="toast-content">
                    <ToastPrimitive.Title className="toast-title">
                        {title}
                    </ToastPrimitive.Title>
                    {description && (
                        <ToastPrimitive.Description className="toast-description">
                            {description}
                        </ToastPrimitive.Description>
                    )}
                </div>
                {action && (
                    <ToastPrimitive.Action asChild altText={action.label}>
                        <button className={`btn btn-sm ${variant === 'danger' ? 'btn-danger' : 'btn-primary'}`} onClick={action.onClick}>
                            {action.label}
                        </button>
                    </ToastPrimitive.Action>
                )}
                <ToastPrimitive.Close className="toast-close">
                    <X size={16} />
                </ToastPrimitive.Close>
            </ToastPrimitive.Root>
            <ToastPrimitive.Viewport className="toast-viewport" />
        </ToastPrimitive.Provider>
    );
};
