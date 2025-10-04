import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import * as XLSX from 'xlsx';

// Types for export data
interface ExportConfig {
  filename?: string;
  title?: string;
  subtitle?: string;
  includeTimestamp?: boolean;
  includeFilters?: boolean;
  filters?: Record<string, any>;
}

interface ChartExportData {
  chartTitle: string;
  data: any[];
  metadata?: Record<string, any>;
}

// CSV Export Functions
export const exportToCSV = (
  data: any[],
  config: ExportConfig = {}
): string => {
  if (!data || data.length === 0) {
    return '';
  }

  const {
    title = 'Dados de Estatísticas',
    includeTimestamp = true,
    includeFilters = false,
    filters = {}
  } = config;

  let csv = '';

  // Add header information
  if (title) {
    csv += `"${title}"\n`;
  }

  if (includeTimestamp) {
    csv += `"Gerado em: ${format(new Date(), 'dd/MM/yyyy HH:mm', { locale: ptBR })}"\n`;
  }

  if (includeFilters && Object.keys(filters).length > 0) {
    csv += '"Filtros Aplicados:"\n';
    Object.entries(filters).forEach(([key, value]) => {
      csv += `"${formatFilterName(key)}: ${formatFilterValue(value)}"\n`;
    });
  }

  csv += '\n'; // Empty line before data

  // Get headers from first object
  const headers = Object.keys(data[0]);
  csv += headers.map(header => `"${formatHeaderName(header)}"`).join(',') + '\n';

  // Add data rows
  data.forEach(row => {
    const values = headers.map(header => {
      const value = row[header];
      if (value === null || value === undefined) {
        return '""';
      }
      if (typeof value === 'string') {
        return `"${value.replace(/"/g, '""')}"`;
      }
      if (typeof value === 'number') {
        return formatNumber(value, header);
      }
      if (value instanceof Date) {
        return `"${format(value, 'dd/MM/yyyy HH:mm', { locale: ptBR })}"`;
      }
      return `"${String(value)}"`;
    });
    csv += values.join(',') + '\n';
  });

  return csv;
};

// Excel Export using xlsx library
export const exportToExcel = (
  chartData: ChartExportData[],
  config: ExportConfig = {}
): ArrayBuffer => {
  const {
    title = 'Relatório de Estatísticas de Estoque',
    includeTimestamp = true,
    includeFilters = false,
    filters = {}
  } = config;

  const workbook = XLSX.utils.book_new();
  const timestamp = format(new Date(), 'dd/MM/yyyy HH:mm', { locale: ptBR });

  // Create summary sheet
  const summaryData = [];
  summaryData.push([title]);
  summaryData.push([]);

  if (includeTimestamp) {
    summaryData.push(['Gerado em:', timestamp]);
  }

  if (includeFilters && Object.keys(filters).length > 0) {
    summaryData.push([]);
    summaryData.push(['Filtros Aplicados:']);
    Object.entries(filters).forEach(([key, value]) => {
      summaryData.push([formatFilterName(key), formatFilterValue(value)]);
    });
  }

  summaryData.push([]);
  summaryData.push(['Planilhas Disponíveis:']);
  chartData.forEach((chart, index) => {
    summaryData.push([`${index + 1}.`, chart.chartTitle]);
  });

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);

  // Style the summary sheet
  summarySheet['!cols'] = [{ width: 20 }, { width: 30 }];

  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Resumo');

  // Create individual sheets for each chart
  chartData.forEach((chart) => {
    if (!chart.data || chart.data.length === 0) return;

    const sheetData = [];

    // Add chart title
    sheetData.push([chart.chartTitle]);
    sheetData.push([]);

    // Add metadata if available
    if (chart.metadata && Object.keys(chart.metadata).length > 0) {
      Object.entries(chart.metadata).forEach(([key, value]) => {
        sheetData.push([key, value]);
      });
      sheetData.push([]);
    }

    // Add headers
    const headers = Object.keys(chart.data[0]);
    const translatedHeaders = headers.map(header => formatHeaderName(header));
    sheetData.push(translatedHeaders);

    // Add data rows
    chart.data.forEach(row => {
      const values = headers.map(header => {
        const value = row[header];
        if (value === null || value === undefined) return '';
        if (typeof value === 'number') return value;
        if (value instanceof Date) return format(value, 'dd/MM/yyyy HH:mm', { locale: ptBR });
        return String(value);
      });
      sheetData.push(values);
    });

    const worksheet = XLSX.utils.aoa_to_sheet(sheetData);

    // Auto-size columns
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
    const colWidths = [];

    for (let col = range.s.c; col <= range.e.c; col++) {
      let maxWidth = 10;
      for (let row = range.s.r; row <= range.e.r; row++) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
        const cell = worksheet[cellAddress];
        if (cell && cell.v) {
          const cellLength = String(cell.v).length;
          maxWidth = Math.max(maxWidth, Math.min(cellLength, 50));
        }
      }
      colWidths.push({ width: maxWidth });
    }
    worksheet['!cols'] = colWidths;

    // Style header row
    const headerRowIndex = sheetData.findIndex(row =>
      Array.isArray(row) && row.includes(translatedHeaders[0])
    );

    if (headerRowIndex >= 0) {
      for (let col = 0; col < headers.length; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: headerRowIndex, c: col });
        if (!worksheet[cellAddress]) worksheet[cellAddress] = {};
        worksheet[cellAddress].s = {
          font: { bold: true },
          fill: { fgColor: { rgb: 'F8FAFC' } },
          border: {
            bottom: { style: 'thin', color: { rgb: 'E5E5E5' } }
          }
        };
      }
    }

    const sheetName = chart.chartTitle.length > 31
      ? `${chart.chartTitle.substring(0, 28)}...`
      : chart.chartTitle;

    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  });

  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
};

// PDF Export (HTML format for PDF generation)
export const exportToPDFHTML = (
  chartData: ChartExportData[],
  config: ExportConfig = {}
): string => {
  const {
    title = 'Relatório de Estatísticas de Estoque',
    subtitle = 'Análise detalhada dos dados de inventário',
    includeTimestamp = true,
    includeFilters = false,
    filters = {}
  } = config;

  const timestamp = format(new Date(), 'dd/MM/yyyy HH:mm', { locale: ptBR });

  let html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #ffffff;
            color: #333;
            line-height: 1.6;
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 2px solid #e5e5e5;
        }
        .header h1 {
            margin: 0;
            color: #2563eb;
            font-size: 28px;
        }
        .header h2 {
            margin: 10px 0 0 0;
            color: #64748b;
            font-size: 16px;
            font-weight: normal;
        }
        .timestamp {
            margin-top: 10px;
            font-size: 14px;
            color: #64748b;
        }
        .filters {
            background-color: #f8fafc;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 30px;
            border-left: 4px solid #2563eb;
        }
        .filters h3 {
            margin: 0 0 10px 0;
            color: #1e293b;
            font-size: 16px;
        }
        .filter-item {
            margin: 5px 0;
            font-size: 14px;
        }
        .chart-section {
            margin-bottom: 40px;
            page-break-inside: avoid;
        }
        .chart-title {
            font-size: 20px;
            color: #1e293b;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 1px solid #e5e5e5;
        }
        .metadata {
            background-color: #f1f5f9;
            padding: 10px;
            border-radius: 6px;
            margin-bottom: 15px;
            font-size: 14px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
            font-size: 14px;
        }
        th, td {
            padding: 8px 12px;
            text-align: left;
            border-bottom: 1px solid #e5e5e5;
        }
        th {
            background-color: #f8fafc;
            font-weight: 600;
            color: #374151;
        }
        tr:nth-child(even) {
            background-color: #f9fafb;
        }
        .numeric {
            text-align: right;
        }
        .page-break {
            page-break-before: always;
        }
        @media print {
            body { padding: 0; }
            .chart-section { page-break-inside: avoid; }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>${title}</h1>
        <h2>${subtitle}</h2>
        ${includeTimestamp ? `<div class="timestamp">Gerado em: ${timestamp}</div>` : ''}
    </div>
`;

  // Add filters section
  if (includeFilters && Object.keys(filters).length > 0) {
    html += `
    <div class="filters">
        <h3>Filtros Aplicados</h3>
`;
    Object.entries(filters).forEach(([key, value]) => {
      html += `        <div class="filter-item"><strong>${formatFilterName(key)}:</strong> ${formatFilterValue(value)}</div>\n`;
    });
    html += `    </div>\n`;
  }

  // Add chart sections
  chartData.forEach((chart, index) => {
    const pageBreak = index > 0 ? ' page-break' : '';
    html += `
    <div class="chart-section${pageBreak}">
        <h2 class="chart-title">${chart.chartTitle}</h2>
`;

    // Add metadata if available
    if (chart.metadata && Object.keys(chart.metadata).length > 0) {
      html += `        <div class="metadata">\n`;
      Object.entries(chart.metadata).forEach(([key, value]) => {
        html += `            <div><strong>${key}:</strong> ${value}</div>\n`;
      });
      html += `        </div>\n`;
    }

    // Add chart data table
    if (chart.data && chart.data.length > 0) {
      const headers = Object.keys(chart.data[0]);
      html += `
        <table>
            <thead>
                <tr>
`;
      headers.forEach(header => {
        const className = isNumericField(header) ? ' class="numeric"' : '';
        html += `                    <th${className}>${formatHeaderName(header)}</th>\n`;
      });
      html += `                </tr>
            </thead>
            <tbody>
`;

      chart.data.forEach(row => {
        html += `                <tr>\n`;
        headers.forEach(header => {
          const value = row[header];
          const className = isNumericField(header) ? ' class="numeric"' : '';
          const formattedValue = formatValueForHTML(value, header);
          html += `                    <td${className}>${formattedValue}</td>\n`;
        });
        html += `                </tr>\n`;
      });

      html += `            </tbody>
        </table>
`;
    }

    html += `    </div>\n`;
  });

  html += `
</body>
</html>`;

  return html;
};

// JSON Export with metadata
export const exportToJSON = (
  chartData: ChartExportData[],
  config: ExportConfig = {}
): string => {
  const {
    title = 'Estatísticas de Estoque',
    includeTimestamp = true,
    includeFilters = false,
    filters = {}
  } = config;

  const exportData = {
    title,
    generatedAt: includeTimestamp ? new Date().toISOString() : undefined,
    filters: includeFilters ? filters : undefined,
    charts: chartData.map(chart => ({
      title: chart.chartTitle,
      metadata: chart.metadata,
      data: chart.data,
      recordCount: chart.data?.length || 0,
    })),
    summary: {
      totalCharts: chartData.length,
      totalRecords: chartData.reduce((sum, chart) => sum + (chart.data?.length || 0), 0),
    },
    exportMetadata: {
      version: '1.0',
      format: 'json',
      encoding: 'utf-8',
      locale: 'pt-BR',
    }
  };

  return JSON.stringify(exportData, null, 2);
};

// Helper functions for formatting
const formatFilterName = (key: string): string => {
  const translations: Record<string, string> = {
    dateRange: 'Período',
    categoryId: 'Categoria',
    brandId: 'Marca',
    supplierId: 'Fornecedor',
    userId: 'Usuário',
    sectorId: 'Setor',
    period: 'Agrupamento',
    movementType: 'Tipo de Movimentação',
    itemId: 'Item',
    reason: 'Motivo',
    status: 'Status',
    activeTab: 'Aba Ativa',
  };
  return translations[key] || key;
};

const formatFilterValue = (value: any): string => {
  if (value === null || value === undefined) return 'Todos';
  if (typeof value === 'object' && value.from && value.to) {
    return `${format(new Date(value.from), 'dd/MM/yyyy', { locale: ptBR })} - ${format(new Date(value.to), 'dd/MM/yyyy', { locale: ptBR })}`;
  }
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  if (typeof value === 'boolean') {
    return value ? 'Sim' : 'Não';
  }
  return String(value);
};

const formatHeaderName = (header: string): string => {
  const translations: Record<string, string> = {
    date: 'Data',
    category: 'Categoria',
    count: 'Quantidade',
    value: 'Valor',
    percentage: 'Percentual',
    total: 'Total',
    itemName: 'Nome do Item',
    userName: 'Usuário',
    sectorName: 'Setor',
    reason: 'Motivo',
    status: 'Status',
    createdAt: 'Criado em',
    updatedAt: 'Atualizado em',
    entradas: 'Entradas',
    saidas: 'Saídas',
    saldo: 'Saldo',
    movements: 'Movimentações',
    hour: 'Horário',
    name: 'Nome',
    trend: 'Tendência',
    price: 'Preço',
    quantity: 'Quantidade',
    supplier: 'Fornecedor',
    brand: 'Marca',
    _secao: 'Seção',
  };
  return translations[header] || header.charAt(0).toUpperCase() + header.slice(1);
};

const isNumericField = (fieldName: string): boolean => {
  const numericFields = [
    'value', 'count', 'quantity', 'percentage', 'total',
    'price', 'cost', 'amount', 'rate', 'score', 'entradas',
    'saidas', 'saldo', 'movements', 'trend'
  ];
  return numericFields.some(field => fieldName.toLowerCase().includes(field));
};

const formatNumber = (value: number, fieldName: string): string => {
  if (fieldName.toLowerCase().includes('percentage')) {
    return value.toFixed(1) + '%';
  }
  if (fieldName.toLowerCase().includes('value') || fieldName.toLowerCase().includes('price') || fieldName.toLowerCase().includes('cost')) {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  if (fieldName.toLowerCase().includes('saldo') && Math.abs(value) > 1000) {
    return value.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  }
  return value.toLocaleString('pt-BR');
};

// Reserved for future Excel export functionality
// const formatNumberForExcel = (value: number, fieldName: string): number => {
//   // For Excel, return raw numbers for better formatting
//   if (fieldName.toLowerCase().includes('percentage')) {
//     return value / 100; // Excel will format as percentage
//   }
//   return value;
// };

const formatValueForHTML = (value: any, fieldName: string): string => {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'number') return formatNumber(value, fieldName);
  if (value instanceof Date) return format(value, 'dd/MM/yyyy HH:mm', { locale: ptBR });
  return String(value);
};

// Export format type for UI components
export type ExportFormat = 'csv' | 'excel' | 'pdf' | 'json';