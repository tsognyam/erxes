import { sendCommonMessage, sendCoreMessage } from '../../messageBroker';

const mutations = {
  /**
   * Create new message
   */
  async modifyWaiterCustomerList(_root, { dealId, customerId, type }) {
    let customerIds = await sendCoreMessage({
      subdomain: 'os',
      data: {
        mainType: 'deal',
        mainTypeIds: [dealId],
        relType: 'waiterCustomer'
      },
      action: 'conformities.filterConformity',
      isRPC: true,
      defaultValue: []
    });

    if (type === 'add' && !customerIds.includes(customerId)) {
      customerIds.push(customerId);
    } else if (type === 'remove') {
      customerIds = customerIds.filter(id => id !== customerId);
    }

    await sendCoreMessage({
      subdomain: 'os',
      data: {
        mainType: 'deal',
        mainTypeId: dealId,
        relType: 'waiterCustomer',
        relTypeIds: customerIds
      },
      action: 'conformities.editConformity',
      isRPC: true,
      defaultValue: []
    });

    return customerIds;
  },

  async createRentpayCustomer(
    _root,
    args: { firstName: string; lastName: string; email: string; phone: string },
    { subdomain }
  ) {
    const customer = await sendCommonMessage({
      subdomain,
      action: 'customers.findOne',
      serviceName: 'contacts',
      data: {
        customerPrimaryEmail: args.email,
        customerPrimaryPhone: args.phone
      },
      isRPC: true
    });

    if (customer) {
      return customer;
    }

    return sendCommonMessage({
      subdomain,
      serviceName: 'contacts',
      action: 'customers.createCustomer',
      data: {
        firstName: args.firstName,
        lastName: args.lastName,
        primaryEmail: args.email,
        primaryPhone: args.phone,
        state: 'customer'
      },
      isRPC: true
    });
  },

  async rentPayDealsEditCustomFieldItem(
    _root,
    { _id, key, value }: { _id: string; key: string; value: any },
    { subdomain }
  ) {
    const deal = await sendCommonMessage({
      subdomain,
      serviceName: 'cards',
      action: 'deals.findOne',
      data: {
        _id
      },
      isRPC: true
    });

    if (!deal) {
      throw new Error('Deal not found');
    }

    const prevData = {};

    (deal.customFieldsData || []).forEach(
      td => (prevData[td.field] = td.value)
    );

    prevData[key] = value;

    const customFieldsData = await sendCommonMessage({
      subdomain,
      serviceName: 'forms',
      action: 'fields.generateTypedListFromMap',
      data: prevData,
      isRPC: true
    });

    const modifier = {
      $set: {
        customFieldsData: await sendCommonMessage({
          serviceName: 'forms',
          subdomain,
          action: 'fields.prepareCustomFieldsData',
          data: customFieldsData,
          isRPC: true
        })
      }
    };

    return sendCommonMessage({
      subdomain,
      serviceName: 'cards',
      action: 'deals.updateOne',
      data: {
        selector: { _id },
        modifier
      },
      isRPC: true
    });
  }
};

export default mutations;
