import React, { useState } from 'react';
import {
  WixDesignSystemProvider,
  Page,
  Card,
  Table,
  Button,
  Badge,
  ToggleSwitch,
  Input,
  FormField,
  Modal,
  Box,
  Heading,
  Text,
  Divider,
} from '@wix/design-system';
import '@wix/design-system/styles.global.css';
import { DepositRule, DepositType, DepositRuleScope } from '../../types';
import { evaluateDepositPlan } from '../../backend/deposit-engine';

const INITIAL_RULES: DepositRule[] = [
  {
    id: 'luxury-furniture-layaway',
    name: 'Luxury Furniture Layaway Plan',
    depositType: 'PERCENTAGE',
    depositValue: 25,
    layawayInstallments: 4,
    installmentFrequency: 'BIWEEKLY',
    minOrderSubtotal: 500,
    scope: 'ALL_PRODUCTS',
    enabled: true,
    description: '25% upfront deposit with remaining balance divided into 4 bi-weekly payments',
  },
  {
    id: 'custom-jewelry-deposit',
    name: 'Custom Jewelry & Rings Deposit',
    depositType: 'PERCENTAGE',
    depositValue: 50,
    layawayInstallments: 2,
    installmentFrequency: 'MONTHLY',
    minOrderSubtotal: 300,
    scope: 'COLLECTION',
    targetCollectionIds: ['custom-jewelry', 'bespoke-rings'],
    enabled: true,
    description: '50% deposit to start production; balance due in 2 monthly installments',
  },
  {
    id: 'high-ticket-electronics',
    name: 'Consumer Electronics Reserve',
    depositType: 'PERCENTAGE',
    depositValue: 20,
    layawayInstallments: 3,
    installmentFrequency: 'MONTHLY',
    minOrderSubtotal: 750,
    scope: 'ALL_PRODUCTS',
    enabled: true,
    description: 'Lock in pricing with 20% down and 3 monthly installment payments',
  },
  {
    id: 'artisan-flat-deposit',
    name: 'Artisan Workshop $150 Flat Deposit',
    depositType: 'FIXED',
    depositValue: 150,
    layawayInstallments: 2,
    installmentFrequency: 'BIWEEKLY',
    minOrderSubtotal: 200,
    scope: 'COLLECTION',
    targetCollectionIds: ['workshops', 'commissions'],
    enabled: false,
    description: 'Flat $150 seat reservation deposit for limited capacity workshops',
  },
];

export default function DepositCraftDashboard() {
  const [rules, setRules] = useState<DepositRule[]>(INITIAL_RULES);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Modal form state
  const [newRuleName, setNewRuleName] = useState('');
  const [newDepositType, setNewDepositType] = useState<DepositType>('PERCENTAGE');
  const [newDepositValue, setNewDepositValue] = useState('25');
  const [newInstallments, setNewInstallments] = useState('4');
  const [newMinSubtotal, setNewMinSubtotal] = useState('250');
  const [newScope, setNewScope] = useState<DepositRuleScope>('ALL_PRODUCTS');
  const [newTargetCollections, setNewTargetCollections] = useState('');

  // Simulator state
  const [simSubtotal, setSimSubtotal] = useState('1200.00');
  const [selectedRuleId, setSelectedRuleId] = useState('luxury-furniture-layaway');

  const toggleRule = (id: string) => {
    setRules(prev =>
      prev.map(r => (r.id === id ? { ...r, enabled: !r.enabled } : r))
    );
  };

  const handleAddRule = () => {
    if (!newRuleName.trim()) return;

    const newRule: DepositRule = {
      id: `rule-${Date.now()}`,
      name: newRuleName.trim(),
      depositType: newDepositType,
      depositValue: parseFloat(newDepositValue) || 20,
      layawayInstallments: parseInt(newInstallments, 10) || 3,
      installmentFrequency: 'BIWEEKLY',
      minOrderSubtotal: parseFloat(newMinSubtotal) || 0,
      scope: newScope,
      targetCollectionIds:
        newScope === 'COLLECTION' && newTargetCollections
          ? newTargetCollections.split(',').map(s => s.trim())
          : undefined,
      enabled: true,
      description: `${newDepositValue}${newDepositType === 'PERCENTAGE' ? '%' : '$'} deposit with ${newInstallments} installments`,
      createdAt: new Date().toISOString(),
    };

    setRules(prev => [newRule, ...prev]);
    setIsModalOpen(false);
    setNewRuleName('');
    setNewDepositValue('25');
    setNewInstallments('4');
    setNewMinSubtotal('250');
    setNewTargetCollections('');
  };

  // Run live simulation
  const activeRule = rules.find(r => r.id === selectedRuleId) || rules[0];
  const simResult = evaluateDepositPlan({
    currency: 'USD',
    lineItems: [
      {
        catalogItemId: 'demo-product-1',
        productName: 'Sample Catalog Product',
        quantity: 1,
        price: parseFloat(simSubtotal) || 0,
        collectionIds: activeRule?.targetCollectionIds || [],
      },
    ],
    rules,
    selectedRuleId: activeRule?.id,
  });

  const activeCount = rules.filter(r => r.enabled).length;

  return (
    <WixDesignSystemProvider>
      <Page>
        <Page.Header
          title="DepositCraft: Layaway & Deposit Checkout Plans"
          subtitle="Empower shoppers with split layaway installments, custom down payments, and zero DevOps overhead"
          actionsBar={
            <Button priority="primary" onClick={() => setIsModalOpen(true)}>
              + Create Deposit Plan
            </Button>
          }
        />
        <Page.Content>
          <Box direction="vertical" gap="24px">
            {/* KPI Cards Row */}
            <Box gap="16px">
              <Card style={{ flex: 1, padding: '16px' }}>
                <Text size="small" secondary>Active Deposit Plans</Text>
                <Heading size="medium">{activeCount} of {rules.length}</Heading>
                <Badge skin="success" size="small">Serverless Live</Badge>
              </Card>
              <Card style={{ flex: 1, padding: '16px' }}>
                <Text size="small" secondary>Supported Structures</Text>
                <Heading size="medium">Fixed & % Splits</Heading>
                <Badge skin="neutral" size="small">Flexible Terms</Badge>
              </Card>
              <Card style={{ flex: 1, padding: '16px' }}>
                <Text size="small" secondary>Catalog Architecture</Text>
                <Heading size="medium">Dual V1 & V3</Heading>
                <Badge skin="success" size="small">100% Native SPI</Badge>
              </Card>
              <Card style={{ flex: 1, padding: '16px' }}>
                <Text size="small" secondary>Monthly Infra Cost</Text>
                <Heading size="medium">$0.00 / mo</Heading>
                <Badge skin="premium" size="small">Wix Serverless</Badge>
              </Card>
            </Box>

            {/* Plans Management Table */}
            <Card>
              <Card.Header
                title="Configured Deposit & Layaway Plans"
                subtitle="Calculated instantaneously in Wix Checkout to maximize order conversion on high-ticket items"
              />
              <Card.Divider />
              <Card.Content>
                <Table
                  data={rules}
                  columns={[
                    {
                      title: 'Plan Name',
                      render: (row: DepositRule) => (
                        <Box direction="vertical">
                          <Text weight="bold">{row.name}</Text>
                          <Text size="tiny" secondary>ID: {row.id}</Text>
                        </Box>
                      ),
                    },
                    {
                      title: 'Deposit Required',
                      render: (row: DepositRule) => (
                        <Box direction="horizontal" gap="6px" verticalAlign="middle">
                          <Badge skin={row.depositType === 'PERCENTAGE' ? 'standard' : 'general'} size="small">
                            {row.depositType}
                          </Badge>
                          <Text weight="bold">
                            {row.depositType === 'PERCENTAGE' ? `${row.depositValue}%` : `$${row.depositValue.toFixed(2)}`}
                          </Text>
                        </Box>
                      ),
                    },
                    {
                      title: 'Layaway Installments',
                      render: (row: DepositRule) => (
                        <Text size="small">
                          {row.layawayInstallments} x {row.installmentFrequency || 'BIWEEKLY'}
                        </Text>
                      ),
                    },
                    {
                      title: 'Min Order Spend',
                      render: (row: DepositRule) => (
                        <Text size="small">
                          {row.minOrderSubtotal ? `$${row.minOrderSubtotal.toFixed(2)}` : 'No minimum'}
                        </Text>
                      ),
                    },
                    {
                      title: 'Catalog Scope',
                      render: (row: DepositRule) => (
                        <Text size="small">
                          {row.scope === 'ALL_PRODUCTS'
                            ? 'All Products'
                            : `Collections: ${(row.targetCollectionIds || []).join(', ')}`}
                        </Text>
                      ),
                    },
                    {
                      title: 'Active',
                      render: (row: DepositRule) => (
                        <ToggleSwitch
                          checked={row.enabled}
                          onChange={() => toggleRule(row.id)}
                        />
                      ),
                    },
                  ]}
                >
                  <Table.Content />
                </Table>
              </Card.Content>
            </Card>

            {/* Live Interactive Layaway Simulator */}
            <Card>
              <Card.Header
                title="Interactive Checkout Layaway Simulator"
                subtitle="Test how checkout deposits and scheduled installment breakdowns appear to shoppers"
              />
              <Card.Divider />
              <Card.Content>
                <Box gap="24px" direction="horizontal">
                  <Box direction="vertical" gap="12px" style={{ flex: 1 }}>
                    <FormField label="Simulated Order Cart Subtotal ($)">
                      <Input
                        type="number"
                        value={simSubtotal}
                        onChange={e => setSimSubtotal(e.target.value)}
                        placeholder="e.g. 1200.00"
                      />
                    </FormField>

                    <FormField label="Select Deposit Plan for Simulation">
                      <Box direction="vertical" gap="8px">
                        {rules.map(r => (
                          <Box
                            key={r.id}
                            padding="8px 12px"
                            style={{
                              backgroundColor: selectedRuleId === r.id ? '#eff6ff' : '#f8fafc',
                              border: `1px solid ${selectedRuleId === r.id ? '#3b82f6' : '#e2e8f0'}`,
                              borderRadius: '6px',
                              cursor: 'pointer',
                              justifyContent: 'space-between',
                            }}
                            onClick={() => setSelectedRuleId(r.id)}
                          >
                            <Box direction="vertical">
                              <Text weight={selectedRuleId === r.id ? 'bold' : 'normal'}>
                                {r.name}
                              </Text>
                              <Text size="tiny" secondary>
                                {r.depositValue}{r.depositType === 'PERCENTAGE' ? '%' : '$'} Down • {r.layawayInstallments} Payments
                              </Text>
                            </Box>
                            <Badge skin={r.enabled ? 'success' : 'neutral'} size="small">
                              {r.enabled ? 'Enabled' : 'Paused'}
                            </Badge>
                          </Box>
                        ))}
                      </Box>
                    </FormField>
                  </Box>

                  <Box
                    direction="vertical"
                    gap="12px"
                    style={{
                      flex: 1,
                      backgroundColor: '#f8fafc',
                      padding: '20px',
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    <Heading size="small">Wix Checkout Payment Breakdown</Heading>
                    <Divider />

                    <Box style={{ justifyContent: 'space-between' }}>
                      <Text>Cart Subtotal:</Text>
                      <Text weight="bold">${parseFloat(simSubtotal || '0').toFixed(2)}</Text>
                    </Box>

                    {simResult.eligible ? (
                      <>
                        <Box style={{ justifyContent: 'space-between', color: '#0f766e' }}>
                          <Text weight="bold">Deposit Due Today (At Checkout):</Text>
                          <Heading size="small" style={{ color: '#0f766e' }}>
                            ${simResult.depositDueNow.toFixed(2)}
                          </Heading>
                        </Box>

                        <Box style={{ justifyContent: 'space-between', color: '#64748b' }}>
                          <Text>Deferred Layaway Balance:</Text>
                          <Text weight="bold">${simResult.remainingBalance.toFixed(2)}</Text>
                        </Box>

                        <Divider />
                        <Heading size="tiny">Upcoming Layaway Installments</Heading>

                        {simResult.layawaySchedule?.schedule.slice(1).map(item => (
                          <Box
                            key={item.installmentNumber}
                            padding="8px"
                            style={{
                              backgroundColor: '#ffffff',
                              borderRadius: '6px',
                              border: '1px solid #e2e8f0',
                              justifyContent: 'space-between',
                            }}
                          >
                            <Box direction="vertical">
                              <Text size="small" weight="bold">{item.label}</Text>
                              <Text size="tiny" secondary>{item.dueDescription}</Text>
                            </Box>
                            <Text weight="bold">${item.amount.toFixed(2)}</Text>
                          </Box>
                        ))}
                      </>
                    ) : (
                      <Box padding="12px" style={{ backgroundColor: '#fef2f2', borderRadius: '6px' }}>
                        <Text size="small" style={{ color: '#991b1b' }}>
                          ⚠️ {simResult.breakdownReasons[0] || 'Plan conditions not met.'}
                        </Text>
                      </Box>
                    )}

                    <Divider />
                    <Text size="tiny" secondary>
                      ⚡ Evaluated in &lt;15ms via native Wix Serverless Functions. Dual Catalog V1 & V3 compatible.
                    </Text>
                  </Box>
                </Box>
              </Card.Content>
            </Card>
          </Box>

          {/* Modal to Add Deposit Plan */}
          <Modal
            isOpen={isModalOpen}
            onRequestClose={() => setIsModalOpen(false)}
            shouldCloseOnOverlayClick
          >
            <Modal.Header title="Create Deposit & Layaway Plan" />
            <Modal.Content>
              <Box direction="vertical" gap="16px" padding="16px">
                <FormField label="Plan Name">
                  <Input
                    placeholder="e.g., Summer Bespoke Furniture Layaway"
                    value={newRuleName}
                    onChange={e => setNewRuleName(e.target.value)}
                  />
                </FormField>

                <Box gap="16px">
                  <Box direction="vertical" style={{ flex: 1 }}>
                    <FormField label="Deposit Type (PERCENTAGE or FIXED)">
                      <Input
                        value={newDepositType}
                        onChange={e =>
                          setNewDepositType(
                            e.target.value.toUpperCase() === 'FIXED' ? 'FIXED' : 'PERCENTAGE'
                          )
                        }
                      />
                    </FormField>
                  </Box>
                  <Box direction="vertical" style={{ flex: 1 }}>
                    <FormField label="Deposit Amount (% or $)">
                      <Input
                        type="number"
                        value={newDepositValue}
                        onChange={e => setNewDepositValue(e.target.value)}
                      />
                    </FormField>
                  </Box>
                </Box>

                <Box gap="16px">
                  <Box direction="vertical" style={{ flex: 1 }}>
                    <FormField label="Layaway Installments Count">
                      <Input
                        type="number"
                        value={newInstallments}
                        onChange={e => setNewInstallments(e.target.value)}
                      />
                    </FormField>
                  </Box>
                  <Box direction="vertical" style={{ flex: 1 }}>
                    <FormField label="Min Order Spend Threshold ($)">
                      <Input
                        type="number"
                        value={newMinSubtotal}
                        onChange={e => setNewMinSubtotal(e.target.value)}
                      />
                    </FormField>
                  </Box>
                </Box>

                <FormField label="Target Scope (ALL_PRODUCTS or COLLECTION)">
                  <Input
                    value={newScope}
                    onChange={e =>
                      setNewScope(
                        e.target.value.toUpperCase() === 'COLLECTION' ? 'COLLECTION' : 'ALL_PRODUCTS'
                      )
                    }
                  />
                </FormField>

                {newScope === 'COLLECTION' && (
                  <FormField label="Collection IDs (comma-separated)">
                    <Input
                      placeholder="e.g., custom-sofas, luxury-beds"
                      value={newTargetCollections}
                      onChange={e => setNewTargetCollections(e.target.value)}
                    />
                  </FormField>
                )}
              </Box>
            </Modal.Content>
            <Modal.Footer>
              <Box gap="12px" style={{ justifyContent: 'flex-end' }}>
                <Button priority="secondary" onClick={() => setIsModalOpen(false)}>
                  Cancel
                </Button>
                <Button priority="primary" onClick={handleAddRule}>
                  Save Plan
                </Button>
              </Box>
            </Modal.Footer>
          </Modal>
        </Page.Content>
      </Page>
    </WixDesignSystemProvider>
  );
}
