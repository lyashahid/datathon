import * as echarts from 'echarts/core';
import { BarChart, LineChart, ScatterChart, HeatmapChart } from 'echarts/charts';
import {
	GridComponent,
	TooltipComponent,
	LegendComponent,
	DataZoomComponent,
	VisualMapComponent,
	AriaComponent
} from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
echarts.use([
	BarChart,
	LineChart,
	ScatterChart,
	HeatmapChart,
	GridComponent,
	TooltipComponent,
	LegendComponent,
	DataZoomComponent,
	VisualMapComponent,
	AriaComponent,
	SVGRenderer
]);
export { echarts };
