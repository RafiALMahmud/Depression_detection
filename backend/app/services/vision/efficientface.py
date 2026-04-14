import torch
import torch.nn as nn

from app.services.vision.efficientface_modulator import Modulator


def depthwise_conv(
    in_planes: int,
    out_planes: int,
    kernel_size: int,
    stride: int = 1,
    padding: int = 0,
    bias: bool = False,
) -> nn.Conv2d:
    return nn.Conv2d(
        in_planes,
        out_planes,
        kernel_size,
        stride,
        padding,
        bias=bias,
        groups=in_planes,
    )


def channel_shuffle(tensor: torch.Tensor, groups: int) -> torch.Tensor:
    batch_size, num_channels, height, width = tensor.size()
    channels_per_group = num_channels // groups

    tensor = tensor.view(batch_size, groups, channels_per_group, height, width)
    tensor = torch.transpose(tensor, 1, 2).contiguous()
    return tensor.view(batch_size, -1, height, width)


class LocalFeatureExtractor(nn.Module):
    def __init__(self, in_planes: int, out_planes: int) -> None:
        super().__init__()

        norm_layer = nn.BatchNorm2d
        self.relu = nn.ReLU()

        self.conv1_1 = depthwise_conv(in_planes, out_planes, kernel_size=3, stride=2, padding=1)
        self.bn1_1 = norm_layer(out_planes)
        self.conv1_2 = depthwise_conv(out_planes, out_planes, kernel_size=3, stride=1, padding=1)
        self.bn1_2 = norm_layer(out_planes)

        self.conv2_1 = depthwise_conv(in_planes, out_planes, kernel_size=3, stride=2, padding=1)
        self.bn2_1 = norm_layer(out_planes)
        self.conv2_2 = depthwise_conv(out_planes, out_planes, kernel_size=3, stride=1, padding=1)
        self.bn2_2 = norm_layer(out_planes)

        self.conv3_1 = depthwise_conv(in_planes, out_planes, kernel_size=3, stride=2, padding=1)
        self.bn3_1 = norm_layer(out_planes)
        self.conv3_2 = depthwise_conv(out_planes, out_planes, kernel_size=3, stride=1, padding=1)
        self.bn3_2 = norm_layer(out_planes)

        self.conv4_1 = depthwise_conv(in_planes, out_planes, kernel_size=3, stride=2, padding=1)
        self.bn4_1 = norm_layer(out_planes)
        self.conv4_2 = depthwise_conv(out_planes, out_planes, kernel_size=3, stride=1, padding=1)
        self.bn4_2 = norm_layer(out_planes)

    def forward(self, tensor: torch.Tensor) -> torch.Tensor:
        patch_11 = tensor[:, :, 0:28, 0:28]
        patch_21 = tensor[:, :, 28:56, 0:28]
        patch_12 = tensor[:, :, 0:28, 28:56]
        patch_22 = tensor[:, :, 28:56, 28:56]

        out_1 = self.relu(self.bn1_1(self.conv1_1(patch_11)))
        out_1 = self.relu(self.bn1_2(self.conv1_2(out_1)))

        out_2 = self.relu(self.bn2_1(self.conv2_1(patch_21)))
        out_2 = self.relu(self.bn2_2(self.conv2_2(out_2)))

        out_3 = self.relu(self.bn3_1(self.conv3_1(patch_12)))
        out_3 = self.relu(self.bn3_2(self.conv3_2(out_3)))

        out_4 = self.relu(self.bn4_1(self.conv4_1(patch_22)))
        out_4 = self.relu(self.bn4_2(self.conv4_2(out_4)))

        top = torch.cat([out_1, out_2], dim=2)
        bottom = torch.cat([out_3, out_4], dim=2)
        return torch.cat([top, bottom], dim=3)


class InvertedResidual(nn.Module):
    def __init__(self, inp: int, oup: int, stride: int) -> None:
        super().__init__()

        if not 1 <= stride <= 3:
            raise ValueError("illegal stride value")

        branch_features = oup // 2
        if stride == 1 and inp != branch_features << 1:
            raise ValueError("stride=1 requires the input channel count to match the branch output layout")

        self.stride = stride

        if stride > 1:
            self.branch1 = nn.Sequential(
                depthwise_conv(inp, inp, kernel_size=3, stride=stride, padding=1),
                nn.BatchNorm2d(inp),
                nn.Conv2d(inp, branch_features, kernel_size=1, stride=1, padding=0, bias=False),
                nn.BatchNorm2d(branch_features),
                nn.ReLU(inplace=True),
            )
        else:
            self.branch1 = None

        self.branch2 = nn.Sequential(
            nn.Conv2d(
                inp if stride > 1 else branch_features,
                branch_features,
                kernel_size=1,
                stride=1,
                padding=0,
                bias=False,
            ),
            nn.BatchNorm2d(branch_features),
            nn.ReLU(inplace=True),
            depthwise_conv(branch_features, branch_features, kernel_size=3, stride=stride, padding=1),
            nn.BatchNorm2d(branch_features),
            nn.Conv2d(branch_features, branch_features, kernel_size=1, stride=1, padding=0, bias=False),
            nn.BatchNorm2d(branch_features),
            nn.ReLU(inplace=True),
        )

    def forward(self, tensor: torch.Tensor) -> torch.Tensor:
        if self.stride == 1:
            tensor_1, tensor_2 = tensor.chunk(2, dim=1)
            out = torch.cat((tensor_1, self.branch2(tensor_2)), dim=1)
        else:
            if self.branch1 is None:
                raise RuntimeError("branch1 must exist when stride > 1")
            out = torch.cat((self.branch1(tensor), self.branch2(tensor)), dim=1)

        return channel_shuffle(out, 2)


class EfficientFace(nn.Module):
    def __init__(self, stages_repeats: list[int], stages_out_channels: list[int], num_classes: int = 7) -> None:
        super().__init__()

        if len(stages_repeats) != 3:
            raise ValueError("expected stages_repeats as list of 3 positive ints")
        if len(stages_out_channels) != 5:
            raise ValueError("expected stages_out_channels as list of 5 positive ints")

        self._stage_out_channels = stages_out_channels

        input_channels = 3
        output_channels = self._stage_out_channels[0]
        self.conv1 = nn.Sequential(
            nn.Conv2d(input_channels, output_channels, 3, 2, 1, bias=False),
            nn.BatchNorm2d(output_channels),
            nn.ReLU(inplace=True),
        )
        input_channels = output_channels

        self.maxpool = nn.MaxPool2d(kernel_size=3, stride=2, padding=1)

        stage_names = ["stage2", "stage3", "stage4"]
        for name, repeats, output_channels in zip(stage_names, stages_repeats, self._stage_out_channels[1:], strict=False):
            blocks: list[nn.Module] = [InvertedResidual(input_channels, output_channels, 2)]
            for _ in range(repeats - 1):
                blocks.append(InvertedResidual(output_channels, output_channels, 1))
            setattr(self, name, nn.Sequential(*blocks))
            input_channels = output_channels

        self.local = LocalFeatureExtractor(29, 116)
        self.modulator = Modulator(116)

        output_channels = self._stage_out_channels[-1]
        self.conv5 = nn.Sequential(
            nn.Conv2d(input_channels, output_channels, 1, 1, 0, bias=False),
            nn.BatchNorm2d(output_channels),
            nn.ReLU(inplace=True),
        )

        self.fc = nn.Linear(output_channels, num_classes)

    def forward(self, tensor: torch.Tensor) -> torch.Tensor:
        tensor = self.conv1(tensor)
        tensor = self.maxpool(tensor)
        tensor = self.modulator(self.stage2(tensor)) + self.local(tensor)
        tensor = self.stage3(tensor)
        tensor = self.stage4(tensor)
        tensor = self.conv5(tensor)
        tensor = tensor.mean([2, 3])
        return self.fc(tensor)


def efficient_face(*, num_classes: int = 7) -> EfficientFace:
    return EfficientFace([4, 8, 4], [29, 116, 232, 464, 1024], num_classes=num_classes)
