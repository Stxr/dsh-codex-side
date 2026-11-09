import type { ClientContext, NativeConversationProps, ReactRuntime, SideControllerProps, SidePanelProps, Translate } from './host';
import type { SideHooks } from './hooks';
import type { SideOperations } from './operations';
import type { SideState } from './state';
/** Component closures belong to apply; importing this module never touches React or the host. */
export declare function createSideComponents(ctx: ClientContext, React: ReactRuntime, t: Translate, state: SideState, hooks: SideHooks, operations: SideOperations): {
    SidePanel: (props: SidePanelProps) => import("react").JSX.Element;
    NativeConversation: (props: NativeConversationProps) => import("react").ReactNode;
    SideController: (props: SideControllerProps) => import("react").JSX.Element | null;
    SideCommandView: () => import("react").JSX.Element;
};
