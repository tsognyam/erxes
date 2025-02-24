import gql from 'graphql-tag';
import * as compose from 'lodash.flowright';
import ButtonMutate from '@erxes/ui/src/components/ButtonMutate';
import { IButtonMutateProps } from '@erxes/ui/src/types';
import { Alert, confirm, withProps } from '@erxes/ui/src/utils';
import React from 'react';
import { graphql } from 'react-apollo';
import List from '../../components/config/Uoms';
import { mutations, queries } from '../../graphql';
import Spinner from '@erxes/ui/src/components/Spinner';
import {
  UomRemoveMutationResponse,
  UomsCountQueryResponse,
  UomsQueryResponse
} from '@erxes/ui-products/src/types';

type Props = {
  history: any;
};

type FinalProps = {
  uomsQuery: UomsQueryResponse;
  uomsCountQuery: UomsCountQueryResponse;
} & Props &
  UomRemoveMutationResponse;

const ListContainer = (props: FinalProps) => {
  const { uomsQuery, uomsCountQuery, uomsRemove } = props;

  if (uomsQuery.loading || uomsCountQuery.loading) {
    return <Spinner />;
  }

  const remove = uom => {
    confirm(`This action will remove the uom. Are you sure?`)
      .then(() => {
        uomsRemove({ variables: { uomIds: [uom._id] } })
          .then(() => {
            Alert.success('You successfully deleted a uom');
            uomsQuery.refetch();
            uomsCountQuery.refetch();
          })
          .catch(e => {
            Alert.error(e.message);
          });
      })
      .catch(e => {
        Alert.error(e.message);
      });
  };

  const renderButton = ({
    name,
    values,
    isSubmitted,
    callback,
    object
  }: IButtonMutateProps) => {
    return (
      <ButtonMutate
        mutation={object ? mutations.uomsEdit : mutations.uomsAdd}
        variables={values}
        callback={callback}
        refetchQueries={refetch}
        isSubmitted={isSubmitted}
        type="submit"
        successMessage={`You successfully ${
          object ? 'updated' : 'added'
        } a ${name}`}
      />
    );
  };

  const updatedProps = {
    ...props,
    uoms: uomsQuery.uoms || [],
    uomsTotalCount: uomsCountQuery.uomsTotalCount || 0,
    loading: uomsQuery.loading,
    renderButton,
    remove
  };

  return <List {...updatedProps} />;
};

const refetch = ['uoms', 'uomsTotalCount'];

export default withProps<Props>(
  compose(
    graphql<Props, UomsQueryResponse>(gql(queries.uoms), {
      name: 'uomsQuery'
    }),
    graphql<Props, UomsCountQueryResponse>(gql(queries.uomsTotalCount), {
      name: 'uomsCountQuery'
    }),
    graphql<Props, UomRemoveMutationResponse, { _id: string }>(
      gql(mutations.uomsRemove),
      {
        name: 'uomsRemove'
      }
    )
  )(ListContainer)
);
