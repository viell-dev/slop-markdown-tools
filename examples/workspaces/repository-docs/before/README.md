# Weather Station

Weather Station collects *temperature*, *humidity*, and *pressure* readings from a sensor board and publishes them as a small web page that updates every minute.

> [!note]
> Use matching firmware and page versions, or the page shows __no data__.

## Usage

Follow the [setup guide](docs/guide.md) first, then read the [sensor reference](docs/reference.md#pressure) to interpret the readings. The [calibration notes](docs/calibration.md) explain how to correct a drifting sensor.

## Status

| Sensor | Unit | Supported |
|---|---|---|
| Temperature | °C | Yes |
| Humidity | % | Yes |
| Pressure | hPa | Since 1.2 |

- [X] Publish readings every minute
- [ ] Keep a week of history
