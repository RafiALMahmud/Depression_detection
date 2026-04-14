import torch
import torch.nn as nn
import torch.nn.functional as F


class Flatten(nn.Module):
    def forward(self, tensor: torch.Tensor) -> torch.Tensor:
        return tensor.view(tensor.size(0), -1)


class Channel(nn.Module):
    def __init__(self, gate_channel: int, reduction_ratio: int = 16, num_layers: int = 1) -> None:
        super().__init__()
        self.gate_c = nn.Sequential()
        self.gate_c.add_module("flatten", Flatten())

        gate_channels = [gate_channel]
        gate_channels += [gate_channel // reduction_ratio] * num_layers
        gate_channels += [gate_channel]

        for index in range(len(gate_channels) - 2):
            self.gate_c.add_module(
                f"gate_c_fc_{index}",
                nn.Linear(gate_channels[index], gate_channels[index + 1]),
            )
            self.gate_c.add_module(
                f"gate_c_bn_{index + 1}",
                nn.BatchNorm1d(gate_channels[index + 1]),
            )
            self.gate_c.add_module(f"gate_c_relu_{index + 1}", nn.ReLU())

        self.gate_c.add_module(
            "gate_c_fc_final",
            nn.Linear(gate_channels[-2], gate_channels[-1]),
        )

    def forward(self, in_tensor: torch.Tensor) -> torch.Tensor:
        avg_pool = F.avg_pool2d(in_tensor, in_tensor.size(2), stride=in_tensor.size(2))
        return self.gate_c(avg_pool).unsqueeze(2).unsqueeze(3).expand_as(in_tensor)


class Spatial(nn.Module):
    def __init__(
        self,
        gate_channel: int,
        reduction_ratio: int = 16,
        dilation_conv_num: int = 2,
        dilation_val: int = 4,
    ) -> None:
        super().__init__()
        reduced_channel = gate_channel // reduction_ratio
        self.gate_s = nn.Sequential()
        self.gate_s.add_module(
            "gate_s_conv_reduce0",
            nn.Conv2d(gate_channel, reduced_channel, kernel_size=1),
        )
        self.gate_s.add_module("gate_s_bn_reduce0", nn.BatchNorm2d(reduced_channel))
        self.gate_s.add_module("gate_s_relu_reduce0", nn.ReLU())

        for index in range(dilation_conv_num):
            self.gate_s.add_module(
                f"gate_s_conv_di_{index}",
                nn.Conv2d(
                    reduced_channel,
                    reduced_channel,
                    kernel_size=3,
                    padding=dilation_val,
                    dilation=dilation_val,
                ),
            )
            self.gate_s.add_module(f"gate_s_bn_di_{index}", nn.BatchNorm2d(reduced_channel))
            self.gate_s.add_module(f"gate_s_relu_di_{index}", nn.ReLU())

        self.gate_s.add_module("gate_s_conv_final", nn.Conv2d(reduced_channel, 1, kernel_size=1))

    def forward(self, in_tensor: torch.Tensor) -> torch.Tensor:
        return self.gate_s(in_tensor).expand_as(in_tensor)


class Modulator(nn.Module):
    def __init__(self, gate_channel: int) -> None:
        super().__init__()
        self.channel_att = Channel(gate_channel)
        self.spatial_att = Spatial(gate_channel)

    def forward(self, in_tensor: torch.Tensor) -> torch.Tensor:
        attention = torch.sigmoid(self.channel_att(in_tensor) * self.spatial_att(in_tensor))
        return attention * in_tensor
