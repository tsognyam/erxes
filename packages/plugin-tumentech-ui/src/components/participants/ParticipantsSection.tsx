import Box from '@erxes/ui/src/components/Box';
import EmptyState from '@erxes/ui/src/components/EmptyState';
import Icon from '@erxes/ui/src/components/Icon';
import ModalTrigger from '@erxes/ui/src/components/ModalTrigger';
import { SectionBodyItem } from '@erxes/ui/src/layout/styles';
import { IButtonMutateProps } from '@erxes/ui/src/types';
import { __, renderFullName } from '@erxes/ui/src/utils/core';
import React from 'react';
import { Link } from 'react-router-dom';

import { IParticipant } from '../../types';
import ParticipantsForm from './ParticipantsForm';

export type Props = {
  actionSection?: any;
  title?: string;
  dealId: string;
  participants: IParticipant[];
  participantsChanged: () => void;
  renderButton: (props: IButtonMutateProps) => JSX.Element;
};

export default function Component({
  actionSection,
  participants,
  title = '',
  renderButton
}: Props) {
  const renderActionSection = customer => {
    if (!actionSection) {
      return;
    }

    const ActionSection = actionSection;
    return <ActionSection customer={customer} isSmall={true} />;
  };

  const renderStatus = participant => {
    if (participant.status !== 'won') {
      return null;
    }

    return <Icon icon="check-square" />;
  };

  const renderBody = participants => {
    if (!participants || !participants.length) {
      return <EmptyState icon="user-6" text="No data" />;
    }

    return (
      <div>
        {participants.map((participant, index) => (
          <SectionBodyItem key={index}>
            <Link to={`/contacts/details/${participant.driver._id}`}>
              {renderFullName(participant.driver)}
              {renderStatus(participant)}
            </Link>
            {renderActionSection(participant.driver)}
          </SectionBodyItem>
        ))}
      </div>
    );
  };

  const manageContent = props => (
    <ParticipantsForm
      participants={participants}
      renderButton={renderButton}
      closeModal={props.closeModal}
    />
  );

  const extraButtons = (
    <>
      {participants.length && (
        <ModalTrigger
          title="Manage"
          size="xl"
          trigger={
            <button>
              <Icon icon="edit-3" />
            </button>
          }
          content={manageContent}
        />
      )}
    </>
  );

  return (
    <Box
      title={__(`${title || 'Customers'}`)}
      extraButtons={extraButtons}
      isOpen={true}
      name="showCustomers"
    >
      {renderBody(participants)}
    </Box>
  );
}
