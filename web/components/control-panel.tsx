'use client';

import { useState } from 'react';
import { useControlPanelServices, useControlPanelServiceAction } from '@/lib/hooks/use-control-panel-services';
import { useControlPanelConfig, useControlPanelConfigUpdate } from '@/lib/hooks/use-control-panel-config';
import { CONSTANTS } from '@/lib/constants';
import { ControlPanelServiceStatus, ConfigValue } from '@/lib/types';

export function ControlPanel() {
  const [activeTab, setActiveTab] = useState<'services' | 'config'>('services');
  const [editingConfig, setEditingConfig] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const { data: services = [], isLoading: servicesLoading } = useControlPanelServices();
  const { data: config = [], isLoading: configLoading } = useControlPanelConfig();
  const serviceActionMutation = useControlPanelServiceAction();
  const configUpdateMutation = useControlPanelConfigUpdate();

  const loading = servicesLoading || configLoading;

  function handleServiceAction(serviceName: string, action: 'start' | 'stop') {
    serviceActionMutation.mutate({ service: serviceName, action });
  }

  function handleConfigUpdate(key: string, value: string) {
    configUpdateMutation.mutate({ key, value }, {
      onSuccess: () => {
        setEditingConfig(null);
        setEditValue('');
      },
    });
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running':
        return 'bg-green-500';
      case 'stopped':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  const formatServiceName = (name: string) => {
    return name.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  return (
    <div className="space-y-4">
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
        <h2 className="text-xl font-bold text-white mb-2">Control Panel</h2>
        <p className="text-slate-400 text-sm">Manage services and configuration</p>
      </div>

      {/* Tabs */}
      <div className="bg-slate-800 rounded-lg border border-slate-700">
        <div className="flex border-b border-slate-700">
          <button
            onClick={() => setActiveTab('services')}
            className={`flex-1 px-4 py-3 text-sm font-medium ${
              activeTab === 'services'
                ? 'text-white border-b-2 border-blue-500'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Services
          </button>
          <button
            onClick={() => setActiveTab('config')}
            className={`flex-1 px-4 py-3 text-sm font-medium ${
              activeTab === 'config'
                ? 'text-white border-b-2 border-blue-500'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Configuration
          </button>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="text-white p-8 text-center">Loading...</div>
          ) : activeTab === 'services' ? (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white mb-4">Service Management</h3>
              {services.map((service) => (
                <div key={service.name} className="bg-slate-900 rounded-lg p-4 border border-slate-700">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${getStatusColor(service.status)}`}></div>
                      <div>
                        <div className="text-white font-medium">{formatServiceName(service.name)}</div>
                        {service.pid && (
                          <div className="text-slate-400 text-sm">PID: {service.pid}</div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {service.status === 'running' ? (
                        <button
                          onClick={() => handleServiceAction(service.name, 'stop')}
                          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-medium"
                          aria-label={`Stop ${formatServiceName(service.name)} service`}
                        >
                          Stop
                        </button>
                      ) : (
                        <button
                          onClick={() => handleServiceAction(service.name, 'start')}
                          className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-medium"
                          aria-label={`Start ${formatServiceName(service.name)} service`}
                        >
                          Start
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white mb-4">Configuration Settings</h3>
              {config.map((item) => (
                <div key={item.key} className="bg-slate-900 rounded-lg p-4 border border-slate-700">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="text-white font-medium mb-1">{item.key}</div>
                      {item.description && (
                        <div className="text-slate-400 text-sm mb-2">{item.description}</div>
                      )}
                      {editingConfig === item.key ? (
                        <div className="flex gap-2">
                          <input
                            type={item.type === 'secret' ? 'password' : item.type === 'number' ? 'number' : 'text'}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="flex-1 px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm"
                            placeholder={item.value}
                            aria-label={`Edit ${item.key} configuration value`}
                            aria-describedby={item.description ? `config-desc-${item.key}` : undefined}
                          />
                          {item.description && (
                            <span id={`config-desc-${item.key}`} className="sr-only">
                              {item.description}
                            </span>
                          )}
                          <button
                            onClick={() => handleConfigUpdate(item.key, editValue)}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => {
                              setEditingConfig(null);
                              setEditValue('');
                            }}
                            className="px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded text-sm"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="text-slate-300 text-sm">
                          {item.type === 'secret' ? '••••••••' : item.value || '(not set)'}
                        </div>
                      )}
                    </div>
                    {editingConfig !== item.key && (
                      <button
                        onClick={() => {
                          setEditingConfig(item.key);
                          setEditValue(item.value);
                        }}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
                        aria-label={`Edit ${item.key} configuration`}
                      >
                        Edit
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

