import React, { Suspense } from 'react';
import { useAppContext } from '../contexts/AppContext';

const AccountModal = React.lazy(() => import('./Modals/AccountModal'));
const AutomationModal = React.lazy(() => import('./Modals/AutomationModal'));
const ConfigModal = React.lazy(() => import('./Modals/ConfigModal'));
const BulkAddModal = React.lazy(() => import('./Modals/BulkAddModal'));
const ShopeePagesModal = React.lazy(() => import('./Modals/ShopeePagesModal'));
const ShopeeAffAccountModal = React.lazy(() => import('./Modals/ShopeeAffAccountModal'));

function ModalLoading() {
  return (
    <div className="empty">
      <span className="spin">...</span>
      <p>Đang tải...</p>
    </div>
  );
}

export default function ModalContainer() {
  const { modalState, closeModal } = useAppContext();

  if (!modalState.type) return null;

  const renderModalContent = () => {
    switch (modalState.type) {
      case 'ACCOUNT':
        return <AccountModal data={modalState.data} />;
      case 'AUTOMATION':
        return <AutomationModal data={modalState.data} />;
      case 'CONFIG':
        return <ConfigModal />;
      case 'BULK_ADD':
        return <BulkAddModal />;
      case 'SHOPEE_PAGES':
        return <ShopeePagesModal />;
      case 'SHOPEE_AFF_ACCOUNT':
        return <ShopeeAffAccountModal data={modalState.data} />;
      default:
        return null;
    }
  };

  return (
    <div className="modal-overlay open" onClick={closeModal}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <Suspense fallback={<ModalLoading />}>
          {renderModalContent()}
        </Suspense>
      </div>
    </div>
  );
}
