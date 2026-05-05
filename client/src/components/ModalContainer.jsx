import React from 'react';
import { useAppContext } from '../contexts/AppContext';
import AccountModal from './Modals/AccountModal';
import AutomationModal from './Modals/AutomationModal';
import ConfigModal from './Modals/ConfigModal';
import BulkAddModal from './Modals/BulkAddModal';
import ShopeePagesModal from './Modals/ShopeePagesModal';

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
      default:
        return null;
    }
  };

  return (
    <div className="modal-overlay open" onClick={closeModal}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        {renderModalContent()}
      </div>
    </div>
  );
}
